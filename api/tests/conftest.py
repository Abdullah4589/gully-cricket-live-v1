"""API tests run against a Postgres 16 container."""

from __future__ import annotations

import asyncio
import os
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

API_ROOT = Path(__file__).resolve().parents[1]


def _asyncpg_url(container: PostgresContainer) -> str:
    return container.get_connection_url(driver="asyncpg")


async def _truncate(url: str) -> None:
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE ball_events, match_snapshots, innings, players, teams, matches "
                "RESTART IDENTITY CASCADE"
            )
        )
    await engine.dispose()


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    with PostgresContainer("postgres:16") as postgres:
        url = _asyncpg_url(postgres)
        env = os.environ.copy()
        env["DATABASE_URL"] = url
        subprocess.check_call(
            ["alembic", "upgrade", "head"],
            cwd=API_ROOT,
            env=env,
        )
        os.environ["DATABASE_URL"] = url
        yield url


@pytest.fixture
def client(database_url: str) -> Iterator[TestClient]:
    asyncio.run(_truncate(database_url))
    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client
