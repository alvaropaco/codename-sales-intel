"""Safe ZIP extraction (spec section 8).

Hardened against Zip Slip, absolute paths, symlinks, and zip bombs. Nothing
inside the archive is trusted: only the sanitized base name is ever used.
"""

from __future__ import annotations

import shutil
import stat
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger

logger = get_logger(__name__)

_SYMLINK_MODE = 0xA000  # S_IFLNK in the high bits of external_attr


def _build_latin1_sanitize_table() -> bytes:
    """Translation table that maps bytes invalid in strict ISO-8859-1 to spaces.

    Receita Federal publishes latin-1 CSVs, but occasional stray control bytes
    (e.g. ``0x1A`` DOS-EOF or the ``0x80``-``0x9F`` C1 range that latin-1 leaves
    undefined) slip in. DuckDB's ``encoding='latin-1'`` reader validates
    strictly and aborts the whole ingest on the first such byte. Real Portuguese
    text only uses ``0xA0``-``0xFF`` for accents, so replacing these control
    bytes with a space is lossless for field content and keeps byte length
    identical (so extracted-size accounting stays exact).
    """
    keep = {0x09, 0x0A, 0x0D}  # tab, newline, carriage return
    table = bytearray(range(256))
    for b in range(0x100):
        if b in keep:
            continue
        if b < 0x20 or b == 0x7F or 0x80 <= b <= 0x9F:
            table[b] = 0x20  # space
    return bytes(table)


#: Byte-for-byte sanitizer applied to extracted text so every file is valid
#: strict latin-1 for the downstream DuckDB reader.
_LATIN1_SANITIZE = _build_latin1_sanitize_table()


class ExtractionError(RuntimeError):
    pass


class UnsafePathError(ExtractionError):
    """Raised when an archive entry tries to escape the destination."""


class SizeLimitExceeded(ExtractionError):
    """Raised when extraction would exceed the configured limits."""


@dataclass(slots=True)
class ExtractedFile:
    name: str
    path: Path
    size: int
    source_archive: str


@dataclass(slots=True)
class ExtractionResult:
    archive: Path
    files: list[ExtractedFile] = field(default_factory=list)

    @property
    def total_bytes(self) -> int:
        return sum(f.size for f in self.files)


def is_safe_member_name(name: str) -> bool:
    """Reject traversal, absolute paths, drive letters and empty names."""
    if not name or name.endswith("/"):
        return False
    if name.startswith(("/", "\\")):
        return False
    if ".." in PurePosixPath(name).parts:
        return False
    if len(name) > 2 and name[1] == ":":  # windows drive letter
        return False
    return "\x00" not in name


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(info.external_attr >> 16)


class Extractor:
    """Streams ZIP members to disk under a flat, sanitized namespace."""

    def __init__(
        self,
        destination: Path,
        max_file_size: int | None = None,
        max_total_size: int | None = None,
    ) -> None:
        settings = get_settings()
        self.destination = destination
        self.destination.mkdir(parents=True, exist_ok=True)
        self.max_file_size = max_file_size or settings.max_extracted_file_size_bytes
        self.max_total_size = max_total_size or settings.max_total_extracted_size_bytes
        self._concurrency = max(1, settings.extract_concurrency)
        self._extracted_total = 0
        self._total_lock = threading.Lock()

    # -- single archive -------------------------------------------------
    def extract(self, archive: Path) -> ExtractionResult:
        if not archive.exists():
            raise ExtractionError(f"archive not found: {archive}")

        result = ExtractionResult(archive=archive)
        written: list[Path] = []

        try:
            with zipfile.ZipFile(archive) as zf:
                bad = zf.testzip()
                if bad is not None:
                    raise ExtractionError(f"{archive.name}: corrupt member {bad!r}")

                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    if _is_symlink(info):
                        raise UnsafePathError(
                            f"{archive.name}: symlink member {info.filename!r} rejected"
                        )
                    if not is_safe_member_name(info.filename):
                        raise UnsafePathError(
                            f"{archive.name}: unsafe member {info.filename!r} rejected"
                        )
                    if info.file_size > self.max_file_size:
                        raise SizeLimitExceeded(
                            f"{archive.name}: {info.filename} is {info.file_size} bytes, "
                            f"limit is {self.max_file_size}"
                        )

                    # Never trust internal directories: flatten to the base name.
                    safe_name = PurePosixPath(info.filename).name
                    target = self.destination / safe_name

                    # Belt and braces: the resolved path must stay inside destination.
                    resolved_root = self.destination.resolve()
                    if not str(target.resolve()).startswith(str(resolved_root)):
                        raise UnsafePathError(
                            f"{archive.name}: {info.filename!r} escapes destination"
                        )

                    written_bytes = self._stream_member(zf, info, target)
                    written.append(target)
                    with self._total_lock:
                        self._extracted_total += written_bytes
                        running_total = self._extracted_total

                    if running_total > self.max_total_size:
                        raise SizeLimitExceeded(
                            f"total extracted size {running_total} exceeds {self.max_total_size}"
                        )

                    result.files.append(
                        ExtractedFile(
                            name=safe_name,
                            path=target,
                            size=written_bytes,
                            source_archive=archive.name,
                        )
                    )
        except (zipfile.BadZipFile, OSError) as exc:
            self._cleanup(written)
            raise ExtractionError(f"{archive.name}: {exc}") from exc
        except ExtractionError:
            self._cleanup(written)
            raise

        logger.info(
            "archive_extracted",
            archive=archive.name,
            files=len(result.files),
            bytes=result.total_bytes,
        )
        return result

    def _stream_member(self, zf: zipfile.ZipFile, info: zipfile.ZipInfo, target: Path) -> int:
        """Copy one member in chunks, enforcing the declared size limit.

        Each chunk is sanitized to valid strict latin-1 (a byte-for-byte
        translation, so length is preserved and chunk boundaries are
        irrelevant) so the downstream DuckDB reader never aborts on a stray
        control byte in the Receita Federal exports.
        """
        written = 0
        chunk_size = 4 * 1024 * 1024
        tmp = target.with_name(target.name + ".partial")
        with zf.open(info) as source, tmp.open("wb") as sink:
            while True:
                chunk = source.read(chunk_size)
                if not chunk:
                    break
                written += len(chunk)
                if written > self.max_file_size:
                    tmp.unlink(missing_ok=True)
                    raise SizeLimitExceeded(
                        f"{info.filename}: exceeded {self.max_file_size} bytes while extracting"
                    )
                sink.write(chunk.translate(_LATIN1_SANITIZE))
        tmp.replace(target)
        return written

    @staticmethod
    def _cleanup(paths: list[Path]) -> None:
        for path in paths:
            path.unlink(missing_ok=True)
            path.with_name(path.name + ".partial").unlink(missing_ok=True)

    # -- batch -----------------------------------------------------------
    def extract_all(self, archives: list[Path]) -> list[ExtractionResult]:
        """Extract every archive with bounded concurrency.

        Archives write disjoint, sanitized base names, so parallel extraction is
        safe. The shared total-size counter is guarded by a lock. On any failure
        every file written by every archive is removed (spec section 8).
        """
        ordered = sorted(archives)
        if self._concurrency == 1 or len(ordered) <= 1:
            results: list[ExtractionResult] = []
            try:
                for archive in ordered:
                    results.append(self.extract(archive))
            except ExtractionError:
                for result in results:
                    self._cleanup([f.path for f in result.files])
                raise
            return results

        results = []
        errors: list[Exception] = []
        with ThreadPoolExecutor(max_workers=self._concurrency) as pool:
            futures = {pool.submit(self.extract, archive): archive for archive in ordered}
            for future in as_completed(futures):
                archive = futures[future]
                try:
                    results.append(future.result())
                except Exception as exc:  # noqa: BLE001 - aggregated below
                    errors.append(exc)
                    logger.error("archive_extract_failed", archive=archive.name, error=str(exc))

        if errors:
            # Spec section 8: clean up everything after a failure.
            for result in results:
                self._cleanup([f.path for f in result.files])
            # Re-raise the first error preserving its type (e.g. UnsafePathError).
            raise errors[0]
        return results

    def purge(self) -> None:
        shutil.rmtree(self.destination, ignore_errors=True)
