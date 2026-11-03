"""HTTP error codes from the scoring contract."""

from __future__ import annotations

from fastapi.responses import JSONResponse

_STATUS = {
    "invalid_request": 400,
    "unauthorized": 401,
    "not_found": 404,
    "id_conflict": 409,
    "uuid_conflict": 409,
    "nothing_to_undo": 409,
}


class ApiError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        self.status = _STATUS.get(code, 422)
        super().__init__(code)


def error_response(code: str, status: int | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status if status is not None else _STATUS.get(code, 422),
        content={"error": code},
    )
