"""Streaming downloader with resume, integrity checks and atomic writes (spec section 7)."""

from __future__ import annotations

import hashlib
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx
from tenacity import (
    RetryError,
    Retrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from cnpj_data_publisher import metrics
from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.receita.discovery import RemoteFile
from cnpj_data_publisher.receita.manifest import DownloadManifest, FileEntry

logger = get_logger(__name__)

PARTIAL_SUFFIX = ".partial"


class DownloadError(RuntimeError):
    pass


class IntegrityError(DownloadError):
    """Raised when a downloaded file does not match the advertised size."""


@dataclass(slots=True)
class DownloadResult:
    name: str
    path: Path
    size: int
    sha256: str
    resumed: bool = False
    skipped: bool = False


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


class Downloader:
    """Downloads snapshot artifacts without ever buffering a whole file in memory."""

    def __init__(
        self,
        destination: Path,
        manifest: DownloadManifest | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        settings = get_settings()
        self.destination = destination
        self.destination.mkdir(parents=True, exist_ok=True)
        self.manifest = manifest or DownloadManifest.load_or_create(destination, destination.name)
        self._chunk_size = settings.receita_download_chunk_size_bytes
        self._timeout = settings.receita_request_timeout_seconds
        self._retries = settings.receita_download_retries
        self._concurrency = settings.receita_max_download_concurrency
        self._allowed_hosts = settings.allowed_download_hosts
        self._external_client = client
        self._manifest_lock = threading.Lock()

    # -- helpers ---------------------------------------------------------
    def _check_host(self, url: str) -> None:
        host = (urlparse(url).hostname or "").lower()
        if self._allowed_hosts and host not in self._allowed_hosts:
            raise DownloadError(f"host {host!r} is not in RECEITA_ALLOWED_HOSTS")

    def _make_client(self) -> httpx.Client:
        if self._external_client is not None:
            return self._external_client
        return httpx.Client(timeout=self._timeout, follow_redirects=True)

    def _is_current(self, remote: RemoteFile, final: Path) -> bool:
        """True when a previous run already produced a verified copy."""
        if not final.exists():
            return False
        entry = self.manifest.get(remote.name)
        if entry is None or not entry.verified:
            return False
        actual = final.stat().st_size
        if entry.downloaded_size != actual:
            return False
        if remote.size is not None and remote.size != actual:
            return False
        return not (remote.etag and entry.etag and remote.etag != entry.etag)

    # -- single file -----------------------------------------------------
    def download_file(
        self, remote: RemoteFile, client: httpx.Client | None = None
    ) -> DownloadResult:
        self._check_host(remote.url)
        final = self.destination / remote.name
        partial = final.with_name(final.name + PARTIAL_SUFFIX)

        if self._is_current(remote, final):
            entry = self.manifest.get(remote.name)
            assert entry is not None and entry.sha256 is not None
            logger.info("download_skipped", file=remote.name, reason="already_verified")
            return DownloadResult(
                name=remote.name,
                path=final,
                size=final.stat().st_size,
                sha256=entry.sha256,
                skipped=True,
            )

        owns_client = client is None
        http = client or self._make_client()
        try:
            resumed = self._stream_to_partial(http, remote, partial)
        finally:
            if owns_client and self._external_client is None:
                http.close()

        size = partial.stat().st_size
        if remote.size is not None and size != remote.size:
            rejected = partial.with_suffix(partial.suffix + ".rejected")
            partial.replace(rejected)
            metrics.download_failures_total.inc()
            raise IntegrityError(
                f"{remote.name}: expected {remote.size} bytes, got {size} (kept at {rejected})"
            )

        checksum = sha256_file(partial)

        # Atomic promotion: only rename after size validation succeeded.
        partial.replace(final)

        entry = FileEntry(
            name=remote.name,
            url=remote.url,
            size=remote.size,
            downloaded_size=size,
            etag=remote.etag,
            last_modified=remote.last_modified,
            sha256=checksum,
            downloaded_at=datetime.now(UTC).isoformat(),
        )
        with self._manifest_lock:
            self.manifest.upsert(entry)
            self.manifest.save(self.destination)

        metrics.download_bytes_total.inc(size)
        logger.info(
            "download_completed",
            file=remote.name,
            bytes=size,
            resumed=resumed,
            sha256=checksum[:16],
        )
        return DownloadResult(
            name=remote.name, path=final, size=size, sha256=checksum, resumed=resumed
        )

    def _stream_to_partial(self, client: httpx.Client, remote: RemoteFile, partial: Path) -> bool:
        """Stream the body to ``partial``, resuming when the server allows it."""
        try:
            for attempt in Retrying(
                stop=stop_after_attempt(self._retries),
                wait=wait_exponential(multiplier=1, min=2, max=60),
                retry=retry_if_exception_type((httpx.HTTPError, OSError)),
                reraise=True,
            ):
                with attempt:
                    offset = partial.stat().st_size if partial.exists() else 0
                    headers: dict[str, str] = {}
                    if offset:
                        headers["Range"] = f"bytes={offset}-"

                    with client.stream("GET", remote.url, headers=headers) as response:
                        if offset and response.status_code == 200:
                            # Server ignored the range request: start over.
                            offset = 0
                            partial.unlink(missing_ok=True)
                        elif offset and response.status_code == 416:
                            # Already have the whole body.
                            return True
                        response.raise_for_status()

                        mode = "ab" if offset else "wb"
                        with partial.open(mode) as handle:
                            for chunk in response.iter_bytes(self._chunk_size):
                                handle.write(chunk)
                    return bool(offset)
        except RetryError as exc:  # pragma: no cover - reraise=True makes this unlikely
            metrics.download_failures_total.inc()
            raise DownloadError(f"{remote.name}: retries exhausted") from exc
        except (httpx.HTTPError, OSError) as exc:
            metrics.download_failures_total.inc()
            raise DownloadError(f"{remote.name}: {exc}") from exc
        return False

    # -- batch -----------------------------------------------------------
    def download_all(self, files: list[RemoteFile]) -> list[DownloadResult]:
        """Download every file with bounded concurrency."""
        results: list[DownloadResult] = []
        errors: list[str] = []

        with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
            futures = {}
            for remote in files:
                client = self._make_client()
                futures[pool.submit(self.download_file, remote, client)] = (remote, client)

            for future in as_completed(futures):
                remote, client = futures[future]
                try:
                    results.append(future.result())
                except Exception as exc:  # noqa: BLE001 - aggregated below
                    errors.append(f"{remote.name}: {exc}")
                    logger.error("download_failed", file=remote.name, error=str(exc))
                finally:
                    if self._external_client is None:
                        client.close()

        if errors:
            raise DownloadError("; ".join(errors))

        with self._manifest_lock:
            self.manifest.mark_completed()
            self.manifest.save(self.destination)
        return sorted(results, key=lambda r: r.name)

    # -- verification -----------------------------------------------------
    def verify_all(self) -> list[str]:
        """Re-check checksums on disk. Returns the list of problems found."""
        problems: list[str] = []
        for entry in self.manifest.files:
            path = self.destination / entry.name
            if not path.exists():
                problems.append(f"{entry.name}: missing on disk")
                continue
            actual_size = path.stat().st_size
            if entry.downloaded_size is not None and actual_size != entry.downloaded_size:
                problems.append(
                    f"{entry.name}: size {actual_size} != manifest {entry.downloaded_size}"
                )
                continue
            if entry.sha256 and sha256_file(path) != entry.sha256:
                problems.append(f"{entry.name}: sha256 mismatch")
        return problems

    def cleanup_partials(self) -> int:
        removed = 0
        for path in self.destination.glob(f"*{PARTIAL_SUFFIX}"):
            path.unlink(missing_ok=True)
            removed += 1
        return removed

    def purge(self) -> None:
        """Remove the entire download directory (used after a fatal failure)."""
        shutil.rmtree(self.destination, ignore_errors=True)
