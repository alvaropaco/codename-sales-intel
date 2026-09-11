"""Command line interface (spec sections 5 and 42)."""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import date
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import configure_logging, get_logger

app = typer.Typer(
    name="cnpj-data-publisher",
    help="Publishes Brazilian CNPJ open-data company events to NATS JetStream.",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()
logger = get_logger(__name__)

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_SKIPPED = 0  # SKIPPED is not a failure (spec section 28)
EXIT_LOCKED = 3
EXIT_EMBED_INCOMPLETE = 4  # embedding finished with pending NULL rows


def _bootstrap(component: str) -> None:
    configure_logging(component=component)


def _serve_metrics() -> None:
    from cnpj_data_publisher.metrics import start_metrics_server

    try:
        start_metrics_server(get_settings().metrics_port)
    except OSError as exc:  # pragma: no cover - port already taken
        logger.warning("metrics_server_unavailable", error=str(exc))


# ---------------------------------------------------------------------
def _migrations_root() -> Path:
    """Locate alembic.ini and migrations/ in both source and container layouts."""
    candidates = [
        Path.cwd(),
        Path(__file__).resolve().parents[2],  # editable install: <repo>/src/pkg -> <repo>
        Path("/app"),  # container WORKDIR
    ]
    for root in candidates:
        if (root / "migrations" / "env.py").exists():
            return root
    raise FileNotFoundError(
        "migrations/ not found; looked in " + ", ".join(str(c) for c in candidates)
    )


@app.command()
def migrate(
    revision: Annotated[str, typer.Option(help="Target revision.")] = "head",
) -> None:
    """Apply database migrations."""
    _bootstrap("migrations")
    from alembic import command
    from alembic.config import Config

    root = _migrations_root()
    ini = root / "alembic.ini"
    config = Config(str(ini)) if ini.exists() else Config()
    config.set_main_option("script_location", str(root / "migrations"))
    config.set_main_option("sqlalchemy.url", get_settings().database_url)

    command.upgrade(config, revision)
    console.print(f"[green]migrations applied[/green] (revision: {revision})")


# ---------------------------------------------------------------------
@app.command()
def ingest(
    snapshot: Annotated[
        str, typer.Option(help="Snapshot version (YYYY-MM) or 'latest'.")
    ] = "latest",
    force: Annotated[
        bool, typer.Option("--force", help="Reprocess a snapshot already marked COMPLETED.")
    ] = False,
) -> None:
    """Run the monthly ingestion pipeline."""
    _bootstrap("ingestor")
    _serve_metrics()

    from cnpj_data_publisher.pipeline import IngestLocked, IngestPipeline

    try:
        result = IngestPipeline(requested_snapshot=snapshot, force=force).run()
    except IngestLocked as exc:
        console.print(f"[yellow]{exc}[/yellow]")
        raise typer.Exit(EXIT_LOCKED) from exc
    except Exception as exc:
        logger.error("ingest_failed", error=str(exc))
        console.print(f"[red]ingestion failed:[/red] {exc}")
        raise typer.Exit(EXIT_ERROR) from exc

    if result.status == "SKIPPED":
        console.print(f"[yellow]skipped:[/yellow] {result.skipped_reason}")
        raise typer.Exit(EXIT_SKIPPED)

    table = Table(title=f"Ingestion {result.snapshot_version}", show_header=False)
    table.add_row("status", result.status)
    for key, value in result.statistics.items():
        table.add_row(str(key), str(value))
    console.print(table)


# ---------------------------------------------------------------------
@app.command(name="ingest-year")
def ingest_year(
    year: Annotated[
        int, typer.Argument(help="Year whose monthly snapshots to ingest (e.g. 2025).")
    ],
    force: Annotated[
        bool, typer.Option("--force", help="Reprocess snapshots already marked COMPLETED.")
    ] = False,
) -> None:
    """Ingest every monthly snapshot of a year, oldest first."""
    _bootstrap("ingestor")
    _serve_metrics()

    from cnpj_data_publisher.pipeline import IngestLocked
    from cnpj_data_publisher.pipeline import ingest_year as run_year

    try:
        results = run_year(year, force=force)
    except IngestLocked as exc:
        console.print(f"[yellow]{exc}[/yellow]")
        raise typer.Exit(EXIT_LOCKED) from exc
    except Exception as exc:
        logger.error("ingest_year_failed", year=year, error=str(exc))
        console.print(f"[red]ingestion failed:[/red] {exc}")
        raise typer.Exit(EXIT_ERROR) from exc

    if not results:
        console.print(f"[yellow]no snapshots found for year {year}[/yellow]")
        raise typer.Exit(EXIT_SKIPPED)

    for result in results:
        if result.status == "SKIPPED":
            console.print(
                f"[yellow]{result.snapshot_version}: skipped[/yellow] ({result.skipped_reason})"
            )
        else:
            console.print(f"[green]{result.snapshot_version}: {result.status}[/green]")


# ---------------------------------------------------------------------
@app.command(name="publish-outbox")
def publish_outbox(
    once: Annotated[bool, typer.Option("--once", help="Drain the outbox once and exit.")] = False,
) -> None:
    """Publish pending outbox events to NATS JetStream."""
    _bootstrap("outbox-publisher")
    _serve_metrics()

    from cnpj_data_publisher.health import (
        HealthState,
        start_health_server,
        watch_nats_health,
    )
    from cnpj_data_publisher.outbox.publisher import (
        OutboxPublisher,
        install_signal_handlers,
    )

    settings = get_settings()
    publisher = OutboxPublisher()

    if once:
        stats = asyncio.run(publisher.run_once())
        console.print(f"published={stats.published} failed={stats.failed}")
        raise typer.Exit(EXIT_ERROR if stats.failed else EXIT_OK)

    state = HealthState()
    server = start_health_server(settings.health_port, state)

    async def main() -> None:
        install_signal_handlers(publisher)
        watcher = asyncio.create_task(watch_nats_health(publisher.publisher, state))
        try:
            await publisher.run_forever()
        finally:
            watcher.cancel()
            state.set_alive(False)

    try:
        asyncio.run(main())
    finally:
        server.shutdown()


# ---------------------------------------------------------------------
@app.command()
def backfill(
    snapshot: Annotated[str, typer.Option(help="Snapshot version or 'latest'.")] = "latest",
    state: Annotated[str | None, typer.Option(help="Filter by state (UF).")] = None,
    main_cnae: Annotated[str | None, typer.Option(help="Filter by main CNAE.")] = None,
    opening_date_from: Annotated[
        str | None, typer.Option(help="Minimum opening date (YYYY-MM-DD).")
    ] = None,
    opening_date_to: Annotated[
        str | None, typer.Option(help="Maximum opening date (YYYY-MM-DD).")
    ] = None,
    headquarters_only: Annotated[
        bool | None, typer.Option("--headquarters-only/--branches-only")
    ] = None,
    company_size: Annotated[str | None, typer.Option(help="Filter by size code.")] = None,
    mei: Annotated[bool | None, typer.Option("--mei/--no-mei")] = None,
    simples: Annotated[bool | None, typer.Option("--simples/--no-simples")] = None,
    rate: Annotated[int, typer.Option(help="Events per second (0 = unlimited).")] = 0,
    batch_size: Annotated[int, typer.Option(help="Rows per batch.")] = 1000,
    restart: Annotated[
        bool, typer.Option("--restart", help="Ignore any resumable run and start over.")
    ] = False,
) -> None:
    """Publish active companies from a snapshot, with rate limiting and resume."""
    _bootstrap("backfill")
    _serve_metrics()

    from cnpj_data_publisher.backfill.service import BackfillFilters, BackfillService
    from cnpj_data_publisher.database.repositories import SnapshotRepository
    from cnpj_data_publisher.database.session import session_scope

    version = snapshot
    if version == "latest":
        with session_scope() as session:
            latest = SnapshotRepository(session).latest_completed()
        if latest is None:
            console.print("[red]no completed snapshot available[/red]")
            raise typer.Exit(EXIT_ERROR)
        version = latest.snapshot_version

    filters = BackfillFilters(
        state=state,
        main_cnae=main_cnae,
        opening_date_from=date.fromisoformat(opening_date_from) if opening_date_from else None,
        opening_date_to=date.fromisoformat(opening_date_to) if opening_date_to else None,
        headquarters_only=headquarters_only,
        company_size_code=company_size,
        mei_option=mei,
        simple_tax_option=simples,
    )

    service = BackfillService(
        snapshot_version=version,
        filters=filters,
        rate_limit=rate,
        batch_size=batch_size,
    )

    try:
        result = service.run(resume=not restart)
    except KeyboardInterrupt:
        console.print("[yellow]backfill paused, rerun the same command to resume[/yellow]")
        raise typer.Exit(EXIT_OK) from None
    except Exception as exc:
        console.print(f"[red]backfill failed:[/red] {exc}")
        raise typer.Exit(EXIT_ERROR) from exc

    console.print_json(json.dumps(result))


# ---------------------------------------------------------------------
@app.command()
def cleanup(
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="Report what would be removed.")
    ] = False,
) -> None:
    """Apply retention policies to data directories and database tables."""
    _bootstrap("cleanup")

    from cnpj_data_publisher.retention import RetentionService

    report = RetentionService(dry_run=dry_run).run()
    console.print_json(json.dumps(report.as_dict()))


# ---------------------------------------------------------------------
def _run_embed_stage(*, snapshot_version: str | None, create_index: bool, notify: bool) -> None:
    """Embed pending rows, report coverage, e-mail the outcome.

    Shared by the ``embed`` (repair) and ``monthly`` (CronJob chain)
    commands. Exits with EXIT_EMBED_INCOMPLETE when rows remain pending so
    the Kubernetes job is marked failed and its backoff resumes later —
    embedding only touches NULL rows, so the retry continues where this
    run stopped.
    """
    from cnpj_data_publisher.notifications import NotificationService
    from cnpj_data_publisher.processing.embedder import Embedder, EmbeddingError

    try:
        embedder = Embedder()
        result = embedder.run()
        if create_index and result.rows_embedded:
            embedder.create_index()
    except EmbeddingError as exc:
        console.print(f"[red]embedding failed:[/red] {exc}")
        if notify:
            NotificationService().send_embed_failure(
                version=snapshot_version or "latest", message=str(exc)
            )
        raise typer.Exit(EXIT_ERROR) from exc

    coverage = embedder.coverage()
    console.print(
        f"[green]embedded[/green] {result.rows_embedded} rows in {result.batches} batches; "
        f"coverage {coverage['embedded']}/{coverage['total']} "
        f"(pending {coverage['pending']})"
    )

    if notify and (result.rows_embedded > 0 or coverage["pending"] > 0):
        NotificationService().send_embed_report(
            version=snapshot_version or "latest",
            rows_embedded=result.rows_embedded,
            batches=result.batches,
            coverage=coverage,
        )

    if coverage["pending"] > 0:
        console.print(f"[red]embedding incomplete:[/red] {coverage['pending']} rows still pending")
        raise typer.Exit(EXIT_EMBED_INCOMPLETE)


# ---------------------------------------------------------------------
@app.command()
def embed(
    create_index: Annotated[
        bool,
        typer.Option("--create-index", help="Create the IVFFlat index after backfilling."),
    ] = False,
    notify: Annotated[
        bool,
        typer.Option("--notify", help="E-mail the coverage report when work was done."),
    ] = False,
    snapshot_version: Annotated[
        str,
        typer.Option(
            "--snapshot-version", help="Snapshot this table was loaded from (for the report)."
        ),
    ] = "",
) -> None:
    """Backfill semantic-search embeddings for the analytical sink table (repair tool)."""
    _bootstrap("embedder")
    _serve_metrics()
    _run_embed_stage(
        snapshot_version=snapshot_version or None,
        create_index=create_index,
        notify=notify,
    )


# ---------------------------------------------------------------------
@app.command()
def monthly(
    snapshot: Annotated[str, typer.Option(help="Snapshot version or 'latest'.")] = "latest",
    force: Annotated[bool, typer.Option("--force", help="Re-ingest even if COMPLETED.")] = False,
    create_index: Annotated[
        bool,
        typer.Option(
            "--create-index/--no-create-index", help="Build the IVFFlat index after embedding."
        ),
    ] = True,
    skip_embed: Annotated[
        bool, typer.Option("--skip-embed", help="Ingest only (no embedding stage).")
    ] = False,
) -> None:
    """Monthly CronJob entrypoint: ingest, then embed + coverage report.

    The ingest step already e-mails success/failure on its own. The embedding
    stage runs right after a successful ingest (a skip falls through fast —
    it is a no-op when no rows are pending) and e-mails its coverage report
    when work was done or rows remain pending.
    """
    _bootstrap("ingestor")
    _serve_metrics()

    from cnpj_data_publisher.pipeline import IngestFailed, IngestLocked, IngestPipeline

    try:
        result = IngestPipeline(requested_snapshot=snapshot, force=force).run()
    except IngestFailed as exc:
        console.print(f"[red]ingest failed[/red] at {exc.stage}: {exc.code} — {exc}")
        raise typer.Exit(EXIT_ERROR) from exc
    except IngestLocked as exc:
        console.print(f"[red]ingest locked:[/red] {exc}")
        raise typer.Exit(EXIT_LOCKED) from exc

    console.print(f"[green]ingest {result.status}[/green] {result.snapshot_version}")
    if skip_embed:
        return

    version = result.snapshot_version if result.status == "COMPLETED" else None
    _run_embed_stage(snapshot_version=version, create_index=create_index, notify=True)


# ---------------------------------------------------------------------
@app.command()
def discover(
    snapshot: Annotated[str, typer.Option(help="Snapshot version or 'latest'.")] = "latest",
) -> None:
    """Inspect the remote portal without downloading anything."""
    _bootstrap("discovery")

    from cnpj_data_publisher.receita.discovery import SnapshotDiscovery

    discovery = SnapshotDiscovery()
    info = discovery.resolve(snapshot)
    if info is None:
        console.print(f"[yellow]no snapshot found for {snapshot!r}[/yellow]")
        raise typer.Exit(EXIT_SKIPPED)

    table = Table(title=f"Snapshot {info.version}")
    table.add_column("file")
    table.add_column("size", justify="right")
    for remote in info.files:
        table.add_row(remote.name, f"{(remote.size or 0) / 1e6:.1f} MB")
    console.print(table)
    console.print(f"complete: {info.complete}")
    if info.missing_prefixes:
        console.print(f"missing: {', '.join(info.missing_prefixes)}")


# ---------------------------------------------------------------------
@app.command()
def status() -> None:
    """Show recent snapshots and outbox backlog."""
    _bootstrap("status")

    from sqlalchemy import select

    from cnpj_data_publisher.database.models import SourceSnapshot
    from cnpj_data_publisher.database.repositories import OutboxRepository
    from cnpj_data_publisher.database.session import session_scope

    with session_scope() as session:
        snapshots = list(
            session.execute(
                select(SourceSnapshot).order_by(SourceSnapshot.snapshot_version.desc()).limit(10)
            ).scalars()
        )
        pending = OutboxRepository(session).count_pending()

    table = Table(title="Snapshots")
    table.add_column("version")
    table.add_column("status")
    table.add_column("completed at")
    for snapshot in snapshots:
        table.add_row(
            snapshot.snapshot_version,
            snapshot.status,
            snapshot.processing_completed_at.isoformat()
            if snapshot.processing_completed_at
            else "-",
        )
    console.print(table)
    console.print(f"pending outbox events: {pending}")


# ---------------------------------------------------------------------
@app.command()
def version() -> None:
    """Print the package version."""
    from cnpj_data_publisher import __version__

    console.print(__version__)


def main() -> None:
    try:
        app()
    except KeyboardInterrupt:  # pragma: no cover
        sys.exit(130)


if __name__ == "__main__":  # pragma: no cover
    main()
