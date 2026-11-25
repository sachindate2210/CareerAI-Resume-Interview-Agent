from __future__ import annotations

from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings


class StorageBackend(ABC):
    """Abstraction over where uploaded files (resumes, generated documents, etc.) live.
    `key` is a backend-relative path such as "resumes/<uuid>/original.pdf".
    """

    @abstractmethod
    def save(self, file_bytes: bytes, key: str) -> str:
        """Persist `file_bytes` under `key` and return a path/URL identifying it."""

    @abstractmethod
    def read(self, key: str) -> bytes:
        """Read back the bytes stored at `key`."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Remove the object at `key`, if it exists."""


class LocalStorageBackend(StorageBackend):
    def __init__(self, base_dir: str) -> None:
        self._base_dir = Path(base_dir)
        self._base_dir.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        path = (self._base_dir / key).resolve()
        base_resolved = self._base_dir.resolve()
        if base_resolved not in path.parents and path != base_resolved:
            raise ValueError(f"Invalid storage key: {key!r}")
        return path

    def save(self, file_bytes: bytes, key: str) -> str:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(file_bytes)
        return str(path)

    def read(self, key: str) -> bytes:
        return self._resolve(key).read_bytes()

    def delete(self, key: str) -> None:
        path = self._resolve(key)
        if path.exists():
            path.unlink()


class S3StorageBackend(StorageBackend):
    def __init__(
        self,
        *,
        bucket: str,
        endpoint_url: str | None,
        access_key: str,
        secret_key: str,
        region: str,
    ) -> None:
        import boto3

        self._bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url or None,
            aws_access_key_id=access_key or None,
            aws_secret_access_key=secret_key or None,
            region_name=region,
        )

    def save(self, file_bytes: bytes, key: str) -> str:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=file_bytes)
        return f"s3://{self._bucket}/{key}"

    def read(self, key: str) -> bytes:
        response = self._client.get_object(Bucket=self._bucket, Key=key)
        return response["Body"].read()

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


@lru_cache
def get_storage() -> StorageBackend:
    settings = get_settings()
    if settings.STORAGE_BACKEND == "s3":
        return S3StorageBackend(
            bucket=settings.S3_BUCKET,
            endpoint_url=settings.S3_ENDPOINT_URL,
            access_key=settings.S3_ACCESS_KEY,
            secret_key=settings.S3_SECRET_KEY,
            region=settings.S3_REGION,
        )
    return LocalStorageBackend(settings.LOCAL_STORAGE_DIR)
