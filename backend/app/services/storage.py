"""Object storage seam. Local disk for dev; swap for S3-compatible storage (encrypted bucket,
signed URLs) before the pilot [D1]."""

from pathlib import Path

from app.config import get_settings


class LocalStorage:
    def __init__(self, root: str | None = None):
        self.root = Path(root or get_settings().storage_dir).resolve()

    def save(self, key: str, data: bytes) -> str:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("Invalid storage key")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def read(self, key: str) -> bytes:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("Invalid storage key")
        return path.read_bytes()


def get_storage() -> LocalStorage:
    return LocalStorage()
