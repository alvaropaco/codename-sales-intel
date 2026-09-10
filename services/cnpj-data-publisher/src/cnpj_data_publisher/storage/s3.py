"""S3-compatible storage backend, MinIO friendly (spec section 27)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import TYPE_CHECKING, Any

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.storage.local import sha256_of, sha256_of_tree

if TYPE_CHECKING:  # pragma: no cover
    pass

logger = get_logger(__name__)

UPLOADING_SUFFIX = ".uploading"


class S3ConfigurationError(RuntimeError):
    pass


class S3Storage:
    """Uploads snapshots, diffs and rejected rows to any S3 API."""

    backend = "S3"

    def __init__(self, client: Any | None = None) -> None:
        self.settings = get_settings()
        if not self.settings.s3_bucket:
            raise S3ConfigurationError("S3_BUCKET is required when STORAGE_BACKEND=S3")
        self.bucket = self.settings.s3_bucket
        self._client = client

    # -- client ------------------------------------------------------------
    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3
            from botocore.config import Config

            self._client = boto3.client(
                "s3",
                endpoint_url=self.settings.s3_endpoint or None,
                region_name=self.settings.s3_region or None,
                aws_access_key_id=self.settings.s3_access_key or None,
                aws_secret_access_key=self.settings.s3_secret_key or None,
                config=Config(
                    s3={
                        "addressing_style": "path" if self.settings.s3_force_path_style else "auto"
                    },
                    retries={"max_attempts": 5, "mode": "standard"},
                ),
            )
        return self._client

    # -- writes ------------------------------------------------------------
    def upload_file(self, source: Path, key: str) -> str:
        """Upload via a temporary key, then promote (spec: write then promote)."""
        staging = key + UPLOADING_SUFFIX
        self.client.upload_file(str(source), self.bucket, staging)
        self.client.copy_object(
            Bucket=self.bucket,
            CopySource={"Bucket": self.bucket, "Key": staging},
            Key=key,
        )
        self.client.delete_object(Bucket=self.bucket, Key=staging)
        return f"s3://{self.bucket}/{key}"

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
                raise RuntimeError("s3 upload failed: " + "; ".join(errors))
        logger.info("s3_directory_uploaded", prefix=prefix, objects=len(uploaded))
        return uploaded

    # -- reads -------------------------------------------------------------
    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
        except Exception:  # noqa: BLE001 - any error means "not usable"
            return False
        return True

    def delete_prefix(self, prefix: str) -> int:
        paginator = self.client.get_paginator("list_objects_v2")
        deleted = 0
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            contents = page.get("Contents", [])
            if not contents:
                continue
            self.client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": obj["Key"]} for obj in contents]},
            )
            deleted += len(contents)
        return deleted

    @staticmethod
    def checksum_of_local(path: Path) -> str:
        return sha256_of_tree(path) if path.is_dir() else sha256_of(path)

    def descriptor(self, prefix: str, manifest_key: str | None = None) -> dict[str, Any]:
        return {
            "type": "S3",
            "bucket": self.bucket,
            "prefix": prefix,
            "manifest": manifest_key,
            "endpoint": self.settings.s3_endpoint or None,
        }
