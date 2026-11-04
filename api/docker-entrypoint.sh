#!/bin/sh
# Migrations and the server use the venv built into the image.
# `uv run` would sync the project again and can stall before /healthz exists.
set -eu

echo "waiting for postgres" >&2
python - <<'PY'
import asyncio
import os
import sys

import asyncpg

raw = os.environ.get("DATABASE_URL", "")
url = raw.replace("postgresql+asyncpg://", "postgresql://", 1).replace(
    "postgres+asyncpg://", "postgresql://", 1
)
if not url.startswith("postgresql://"):
    print(f"DATABASE_URL is not an asyncpg URL: {raw!r}", file=sys.stderr)
    sys.exit(1)


async def wait() -> None:
    last: Exception | None = None
    for _ in range(60):
        try:
            # Compose Postgres does not speak SSL. A default asyncpg probe can
            # sit on that handshake until the process is killed.
            connection = await asyncio.wait_for(
                asyncpg.connect(url, timeout=2, ssl=False),
                timeout=3,
            )
        except Exception as exc:  # noqa: BLE001 — retry until postgres accepts connections
            last = exc
            print(f"postgres not ready: {type(exc).__name__}: {exc}", flush=True)
            await asyncio.sleep(1)
            continue
        await connection.close()
        print("postgres ready", flush=True)
        return
    print(f"postgres not ready after 60s: {last}", file=sys.stderr)
    sys.exit(1)


asyncio.run(wait())
PY

echo "alembic upgrade head" >&2
alembic upgrade head
echo "starting uvicorn" >&2
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
