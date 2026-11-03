"""Gully Cricket Live API."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.broadcast import InMemoryHub
from app.db import create_db_engine, create_sessionmaker
from app.errors import ApiError, error_response
from app.routes.matches import router as matches_router
from app.routes.public import router as public_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    engine = create_db_engine()
    app.state.sessionmaker = create_sessionmaker(engine)
    app.state.hub = InMemoryHub()
    try:
        yield
    finally:
        await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="Gully Cricket Live", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(public_router)
    app.include_router(matches_router)

    @app.exception_handler(ApiError)
    async def on_api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.code, exc.status)

    @app.exception_handler(RequestValidationError)
    async def on_invalid(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return error_response("invalid_request")

    return app


app = create_app()
