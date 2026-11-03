"""Scorer tokens. The plaintext is returned once and never logged."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets

from app.errors import ApiError

SLUG_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def new_token() -> str:
    token = secrets.token_urlsafe(32)
    if len(token) < 22:
        raise RuntimeError("scorer token was shorter than 22 characters")
    return token


def new_slug() -> str:
    slug = secrets.token_urlsafe(12)
    if SLUG_RE.fullmatch(slug) is None:
        raise RuntimeError("public slug did not match the contract pattern")
    return slug


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_match(presented: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_token(presented), stored_hash)


def bearer_token(header: str) -> str:
    scheme, _, rest = header.partition(" ")
    token = rest.strip()
    if scheme.lower() != "bearer" or token == "":
        raise ApiError("unauthorized")
    return token
