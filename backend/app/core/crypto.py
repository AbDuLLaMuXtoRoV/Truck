"""Encryption for secrets at rest (Gmail OAuth tokens) [blueprint sec. 9]."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


def _fernet() -> Fernet:
    settings = get_settings()
    key = settings.encryption_key
    if not key:
        # Derived fallback so dev works out of the box; production must set ENCRYPTION_KEY.
        key = base64.urlsafe_b64encode(hashlib.sha256(("fernet:" + settings.jwt_secret).encode()).digest()).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(value: str | None) -> str | None:
    if value is None:
        return None
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return None
