"""Native Google Cloud Storage backend (spec section 27).

Uses the ``google-cloud-storage`` SDK with a service-account JSON key or
Application Default Credentials (Workload Identity on GKE). Mirrors the
``S3Storage`` interface exactly, including the write-then-promote pattern and
concurrent directory uploads.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.storage.local import sha256_of, sha256_of_tree

logger = get_logger(__name__)

UPLOADING_SUFFIX = ".uploading"


class GCSConfigurationError(RuntimeError):
    pass


class GCSStorage:
    """Uploads snapshots, diffs and rejected rows to a GCS bucket."""

    backend = "GCS"

    def __init__(self, client: Any | None = None) -> None:
        self.settings = get_settings()
        if not self.settings.gcs_bucket:
            raise GCSConfigurationError("GCS_BUCKET is required when STORAGE_BACKEND=GCS")
        self.bucket_name = self.settings.gcs_bucket
        self._client = client
        self._bucket = None

    # -- client ------------------------------------------------------------
    @property
    def client(self) -> Any:
        if self._client is None:
            from google.cloud import storage  # imported lazily

            key_file = self.settings.google_application_credentials
            if key_file:
                self._client = storage.Client.from_service_account_json(
                    key_file, project=self.settings.gcs_project or None
                )
            else:
                # Application Default Credentials (Workload Identity, metadata).
                self._client = storage.Client(project=self.settings.gcs_project or None)
        return self._client

    @property
    def bucket(self) -> Any:
        if self._bucket is None:
            self._bucket = self.client.bucket(self.bucket_name)
        return self._bucket

    # -- writes ------------------------------------------------------------
    def upload_file(self, source: Path, key: str) -> str:
        """Upload via a temporary object, then promote (write then promote)."""
        staging = key + UPLOADING_SUFFIX
        staging_blob = self.bucket.blob(staging)
        staging_blob.upload_from_filename(str(source))
        # Server-side copy to the final key, then drop the staging object.
        self.bucket.copy_blob(staging_blob, self.bucket, key)
        staging_blob.delete()
        return f"gs://{self.bucket_name}/{key}"

    def upload_directory(self, source: Path, prefix: str) -> list[str]:
        files = sorted(p for p in source.rglob("*") if p.is_file())
        concurrency = max(1, self.settings.s3_upload_concurrency)

        def _one(path: Path) -> str:
            key = f"{prefix.rstrip('/')}/{path.relative_to(source)}"
            return self.upload_file(path, key)

        if concurrency == 1 or len(files) <= 1:
            uploaded = [_one(path) for path in files]
        else:
            uploaded = []
            errors: list[str] = []
            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                futures = {pool.submit(_one, path): path for path in files}
                for future in as_completed(futures):
                    path = futures[future]
                    try:
                        uploaded.append(future.result())
                    except Exception as exc:  # noqa: BLE001 - aggregated below
                        errors.append(f"{path.relative_to(source)}: {exc}")
            if errors:
                raise RuntimeError("gcs upload failed: " + "; ".join(errors))
        logger.info("gcs_directory_uploaded", prefix=prefix, objects=len(uploaded))
        return uploaded

    # -- reads -------------------------------------------------------------
    def exists(self, key: str) -> bool:
        try:
            return bool(self.bucket.blob(key).exists())
        except Exception:  # noqa: BLE001 - any error means "not usable"
            return False

    def delete_prefix(self, prefix: str) -> int:
        deleted = 0
        for blob in self.client.list_blobs(self.bucket_name, prefix=prefix):
            blob.delete()
            deleted += 1
        return deleted

    @staticmethod
    def checksum_of_local(path: Path) -> str:
        return sha256_of_tree(path) if path.is_dir() else sha256_of(path)

    def descriptor(self, prefix: str, manifest_key: str | None = None) -> dict[str, Any]:
        return {
            "type": "GCS",
            "bucket": self.bucket_name,
            "prefix": prefix,
            "manifest": manifest_key,
            "endpoint": "https://storage.googleapis.com",
        }
