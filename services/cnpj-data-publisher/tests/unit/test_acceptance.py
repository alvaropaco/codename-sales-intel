"""Acceptance criteria from spec section 45, checked automatically.

Each test maps to one numbered criterion so a failure points straight at the
requirement it violates.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False)


# 1. docker compose brings up PostgreSQL, NATS and the publisher.
def test_01_compose_defines_the_full_stack() -> None:
    compose = (ROOT / "docker-compose.yml").read_text()

    assert "postgres:16" in compose
    assert "nats:2.10" in compose
    assert "outbox-publisher:" in compose
    assert "--jetstream" in compose
    assert "healthcheck:" in compose


# 2. Migrations run without manual intervention.
def test_02_migrations_are_declarative() -> None:
    versions = list((ROOT / "migrations" / "versions").glob("*.py"))

    assert versions, "no migration revisions found"
    initial = (ROOT / "migrations" / "versions" / "0001_initial.py").read_text()
    for table in (
        "source_snapshots",
        "ingest_runs",
        "event_outbox",
        "backfill_runs",
        "rejected_rows",
        "system_locks",
    ):
        assert f'"{table}"' in initial, f"{table} is missing from the initial migration"


# 3-9 are covered end to end in tests/e2e/test_pipeline.py and tests/unit/test_diff.py.
def test_03_to_09_event_rules_are_covered() -> None:
    diff_tests = (ROOT / "tests" / "unit" / "test_diff.py").read_text()

    for name in (
        "test_new_active_company_is_discovered",
        "test_changed_company_is_updated",
        "test_reactivated_company_detected",
        "test_inactivated_company_detected",
        "test_unchanged_company_generates_no_event",
        "test_new_inactive_company_generates_no_event",
    ):
        assert name in diff_tests, f"missing coverage: {name}"


# 10. Events always pass through the PostgreSQL outbox.
def test_10_no_direct_publishing_outside_the_publisher() -> None:
    for path in (ROOT / "src").rglob("*.py"):
        if path.name == "publisher.py" and path.parent.name == "outbox":
            continue
        source = path.read_text()
        assert "js.publish" not in source, f"{path} publishes directly to NATS"
        assert "jetstream()" not in source, f"{path} opens JetStream outside the publisher"


# 11-12. Events reach JetStream and validate against their schemas.
def test_11_12_schemas_exist_for_every_subject() -> None:
    from cnpj_data_publisher.events.schemas import SCHEMA_FILES
    from cnpj_data_publisher.events.subjects import EventType

    for event_type in EventType:
        assert event_type in SCHEMA_FILES
        assert (ROOT / "contracts" / SCHEMA_FILES[event_type]).exists()


# 13-14. Failures and restarts never lose events.
def test_13_14_durability_is_tested() -> None:
    integration = (ROOT / "tests" / "integration" / "test_outbox_nats.py").read_text()
    e2e = (ROOT / "tests" / "e2e" / "test_pipeline.py").read_text()

    assert "test_nats_outage_keeps_events" in integration
    assert "test_publisher_restart_does_not_lose_events" in e2e


# 15. Backfill can stop and resume.
def test_15_backfill_resume_is_tested() -> None:
    backfill = (ROOT / "tests" / "integration" / "test_backfill.py").read_text()
    assert "test_backfill_resumes_from_cursor" in backfill


# 16. The first snapshot defaults to STORE_ONLY.
def test_16_initial_snapshot_mode_defaults_to_store_only() -> None:
    from cnpj_data_publisher.config import InitialSnapshotMode, Settings

    settings = Settings(_env_file=None)
    assert settings.initial_snapshot_mode is InitialSnapshotMode.STORE_ONLY
    assert "INITIAL_SNAPSHOT_MODE=STORE_ONLY" in (ROOT / ".env.example").read_text()


# 17-18. The chart lints and templates with values-k3s.yaml.
@pytest.mark.skipif(not os.environ.get("PATH"), reason="no PATH")
def test_17_18_helm_chart_is_valid() -> None:
    if _run("helm", "version", "--short").returncode != 0:
        pytest.skip("helm is not installed")

    chart = "helm/cnpj-data-publisher"
    assert _run("helm", "lint", chart).returncode == 0
    assert _run("helm", "lint", chart, "-f", f"{chart}/values-k3s.yaml").returncode == 0

    rendered = _run("helm", "template", "acceptance", chart, "-f", f"{chart}/values-k3s.yaml")
    assert rendered.returncode == 0
    assert "kind: CronJob" in rendered.stdout
    assert "kind: Deployment" in rendered.stdout


# 19. Containers never run as root.
def test_19_containers_run_as_non_root() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text()
    assert "USER app:app" in dockerfile
    assert (
        "runAsNonRoot: true" in (ROOT / "helm" / "cnpj-data-publisher" / "values.yaml").read_text()
    )


# 20. Structured logs and metrics are available.
def test_20_observability_is_wired() -> None:
    from cnpj_data_publisher import metrics

    for name in (
        "snapshot_runs_total",
        "rows_processed_total",
        "rows_rejected_total",
        "diff_companies_total",
        "outbox_pending_total",
        "outbox_published_total",
        "outbox_failed_total",
        "backfill_progress",
    ):
        assert hasattr(metrics, name), f"missing metric: {name}"

    logging_source = (ROOT / "src" / "cnpj_data_publisher" / "logging.py").read_text()
    assert "JSONRenderer" in logging_source
    assert "REDACTED" in logging_source


# 21. The README documents a complete installation.
def test_21_readme_is_complete() -> None:
    readme = (ROOT / "README.md").read_text()

    for section in (
        "## Objetivo",
        "## Arquitetura",
        "## Contratos NATS",
        "## Execução local",
        "## Execução com Docker",
        "## Deploy em K3s",
        "## Backfill",
        "## Retenção",
        "## Observabilidade",
        "## Troubleshooting",
    ):
        assert section in readme, f"README is missing {section}"
    assert "mermaid" in readme


# 22. No enrichment code exists anywhere in the project.
def test_22_no_enrichment_coupling() -> None:
    """The service must not know about any consumer.

    This targets real coupling: imports, subject names and domain concepts that
    belong to an enrichment system. The English word "enrichment" is allowed in
    unrelated prose (for example HTTP metadata enrichment).
    """
    forbidden = (
        "shadowtrace",
        "bbot",
        "lead_score",
        "leadscore",
        "lead scoring",
        "enriquecimento",
        "domain_discovery",
        "social_media",
        "email_validation",
    )

    offenders: list[str] = []
    for path in list((ROOT / "src").rglob("*.py")) + list((ROOT / "contracts").glob("*.json")):
        lowered = path.read_text().lower()
        for term in forbidden:
            if term in lowered:
                offenders.append(f"{path.relative_to(ROOT)}: {term}")

        # No consumer-owned subjects may be referenced.
        for line in lowered.splitlines():
            if "enrichment" in line and ("subject" in line or "import" in line):
                offenders.append(f"{path.relative_to(ROOT)}: enrichment coupling in {line.strip()}")

    assert not offenders, "enrichment coupling found: " + "; ".join(offenders)


def test_22b_service_only_publishes_its_own_subjects() -> None:
    """The service publishes and never subscribes (spec section 20.2)."""
    from cnpj_data_publisher.events.subjects import all_subjects, stream_subject_filter

    for subject in all_subjects():
        assert subject.startswith("company.br.cnpj."), subject
    assert stream_subject_filter() == "company.br.cnpj.>"

    for path in (ROOT / "src").rglob("*.py"):
        source = path.read_text()
        assert "pull_subscribe" not in source, f"{path} subscribes to events"
        assert "js.subscribe" not in source, f"{path} subscribes to events"


# Contract stability: v1 schemas must never require new fields.
def test_contracts_are_self_consistent() -> None:
    from jsonschema import Draft202012Validator

    for path in sorted((ROOT / "contracts").glob("*.schema.json")):
        schema = json.loads(path.read_text())
        Draft202012Validator.check_schema(schema)
        assert schema["properties"]["event_version"]["const"] == 1
        assert schema["additionalProperties"] is False
