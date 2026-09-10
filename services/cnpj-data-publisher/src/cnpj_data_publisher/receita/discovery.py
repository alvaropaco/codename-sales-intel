"""Snapshot discovery against the Receita Federal open-data portal (spec section 6)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger

logger = get_logger(__name__)

SNAPSHOT_VERSION_RE = re.compile(r"^\d{4}-\d{2}$")
#: Some mirrors (e.g. casadosdados) publish full-date folders ``YYYY-MM-DD``.
SNAPSHOT_FOLDER_RE = re.compile(r"^\d{4}-\d{2}(?:-\d{2})?$")
_DIR_HREF_RE = re.compile(r'href="([^"?]+)/"', re.IGNORECASE)
_ZIP_HREF_RE = re.compile(r'href="([^"?]+\.zip)"', re.IGNORECASE)
_VERSION_IN_PATH_RE = re.compile(r"(\d{4}-\d{2}(?:-\d{2})?)")


def _canonical_version(folder: str) -> str:
    """Reduce a remote folder name to the canonical ``YYYY-MM`` snapshot version.

    The mirror publishes dated folders (``2026-07-12``) but the pipeline keys
    everything (dirs, DB rows, month-over-month diffs) by month, so the day is
    dropped for the internal version while the original folder is used remotely.
    """
    return folder[:7]


#: File name prefixes that must be present for a snapshot to be usable.
REQUIRED_PREFIXES: tuple[str, ...] = (
    "empresas",
    "estabelecimentos",
    "cnaes",
    "municipios",
    "naturezas",
    "paises",
    "qualificacoes",
    "simples",
)

PARTNER_PREFIXES: tuple[str, ...] = ("socios",)


class DiscoveryError(RuntimeError):
    """Raised when the remote portal cannot be inspected."""


@dataclass(frozen=True, slots=True)
class RemoteFile:
    name: str
    url: str
    size: int | None = None
    etag: str | None = None
    last_modified: str | None = None


@dataclass(frozen=True, slots=True)
class SnapshotInfo:
    version: str
    source_url: str
    files: tuple[RemoteFile, ...]
    complete: bool
    missing_prefixes: tuple[str, ...] = ()

    @property
    def total_size(self) -> int:
        return sum(f.size or 0 for f in self.files)


def required_prefixes(include_partners: bool) -> tuple[str, ...]:
    return REQUIRED_PREFIXES + (PARTNER_PREFIXES if include_partners else ())


class SnapshotDiscovery:
    """Lists available monthly snapshots and validates their completeness."""

    def __init__(
        self,
        base_url: str | None = None,
        include_partners: bool | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.receita_base_url).rstrip("/")
        self.include_partners = (
            settings.receita_include_partners if include_partners is None else include_partners
        )
        self._timeout = settings.receita_request_timeout_seconds
        self._allowed_hosts = settings.allowed_download_hosts
        self._external_client = client

    # -- host allowlist -------------------------------------------------
    def _check_host(self, url: str) -> None:
        host = (urlparse(url).hostname or "").lower()
        if self._allowed_hosts and host not in self._allowed_hosts:
            raise DiscoveryError(f"host {host!r} is not in RECEITA_ALLOWED_HOSTS")

    def _client(self) -> httpx.Client:
        if self._external_client is not None:
            return self._external_client
        return httpx.Client(timeout=self._timeout, follow_redirects=True)

    def _get(self, client: httpx.Client, url: str) -> str | None:
        self._check_host(url)
        try:
            response = client.get(url)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("listing_failed", url=url, error=str(exc))
            return None
        return response.text

    # -- public API -----------------------------------------------------
    def _list_folders(self) -> list[str]:
        """Return raw snapshot folder names (``YYYY-MM`` or ``YYYY-MM-DD``), sorted."""
        client = self._client()
        try:
            html = self._get(client, self.base_url + "/")
            if html is None:
                raise DiscoveryError(f"cannot list snapshots at {self.base_url}")
            folders: set[str] = set()
            for href in _DIR_HREF_RE.findall(html):
                candidate = href.rstrip("/").rsplit("/", 1)[-1]
                if SNAPSHOT_FOLDER_RE.match(candidate):
                    folders.add(candidate)
            # Some mirrors render plain text instead of anchors.
            if not folders:
                folders.update(
                    m for m in _VERSION_IN_PATH_RE.findall(html) if SNAPSHOT_FOLDER_RE.match(m)
                )
            return sorted(folders)
        finally:
            if self._external_client is None:
                client.close()

    def list_versions(self) -> list[str]:
        """Return every canonical ``YYYY-MM`` snapshot version, sorted ascending."""
        return sorted({_canonical_version(f) for f in self._list_folders()})

    def _resolve_folder(self, version: str) -> str | None:
        """Find the remote folder for a canonical ``YYYY-MM`` version.

        Direct ``YYYY-MM`` folders (Receita portal) are returned as-is; dated
        mirror folders are matched by month.
        """
        for folder in reversed(self._list_folders()):
            if _canonical_version(folder) == version:
                return folder
        return None

    def get_snapshot(self, version: str) -> SnapshotInfo | None:
        """Fetch and validate the file listing of one snapshot.

        ``version`` may be a canonical ``YYYY-MM`` value or a dated mirror
        folder ``YYYY-MM-DD``; the returned :class:`SnapshotInfo` always exposes
        the canonical ``YYYY-MM`` version.
        """
        if not SNAPSHOT_FOLDER_RE.match(version):
            raise ValueError(f"invalid snapshot version {version!r}, expected YYYY-MM")

        canonical = _canonical_version(version)
        # A dated folder is used directly; a bare month is tried first, then
        # resolved against the listing in case the mirror uses dated folders.
        url = f"{self.base_url}/{version}/"
        client = self._client()
        try:
            html = self._get(client, url)
            if html is None and len(version) == 7:
                resolved = self._resolve_folder(canonical)
                if resolved is None:
                    return None
                url = f"{self.base_url}/{resolved}/"
                html = self._get(client, url)
            if html is None:
                return None

            names = sorted({href.rsplit("/", 1)[-1] for href in _ZIP_HREF_RE.findall(html)})
            if not names:
                return None

            files = tuple(
                self._head(client, RemoteFile(name=name, url=urljoin(url, name))) for name in names
            )
            missing = self._missing_prefixes(files)
            return SnapshotInfo(
                version=canonical,
                source_url=url,
                files=files,
                complete=not missing,
                missing_prefixes=missing,
            )
        finally:
            if self._external_client is None:
                client.close()

    def get_latest_complete(self) -> SnapshotInfo | None:
        """Most recent snapshot that has every required file."""
        for folder in reversed(self._list_folders()):
            info = self.get_snapshot(folder)
            if info is not None and info.complete:
                return info
            if info is not None:
                logger.info(
                    "snapshot_incomplete",
                    snapshot_version=info.version,
                    missing=list(info.missing_prefixes),
                )
        return None

    def resolve(self, requested: str) -> SnapshotInfo | None:
        """Resolve ``latest`` or an explicit ``YYYY-MM`` / ``YYYY-MM-DD`` version."""
        if requested.lower() == "latest":
            return self.get_latest_complete()
        return self.get_snapshot(requested)

    # -- internals -------------------------------------------------------
    def _missing_prefixes(self, files: tuple[RemoteFile, ...]) -> tuple[str, ...]:
        lowered = [f.name.lower() for f in files]
        missing = [
            prefix
            for prefix in required_prefixes(self.include_partners)
            if not any(name.startswith(prefix) for name in lowered)
        ]
        return tuple(missing)

    def _head(self, client: httpx.Client, remote: RemoteFile) -> RemoteFile:
        """Best-effort metadata enrichment; failures keep the bare entry."""
        try:
            self._check_host(remote.url)
            response = client.head(remote.url)
            response.raise_for_status()
        except (httpx.HTTPError, DiscoveryError) as exc:
            logger.debug("head_failed", url=remote.url, error=str(exc))
            return remote

        size: int | None = None
        raw_length = response.headers.get("content-length")
        if raw_length is not None:
            try:
                size = int(raw_length)
            except ValueError:
                size = None

        return RemoteFile(
            name=remote.name,
            url=remote.url,
            size=size,
            etag=response.headers.get("etag"),
            last_modified=response.headers.get("last-modified"),
        )
