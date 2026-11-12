"""The public scorecard must match contracts/openapi.yaml."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml
from starlette.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
OPENAPI = ROOT / "contracts" / "openapi.yaml"


class SchemaError(Exception):
    pass


def test_public_scorecard_matches_openapi(client: TestClient) -> None:
    created = client.post("/matches", json=_payload())
    assert created.status_code == 201
    body = created.json()
    slug = body["public_slug"]
    headers = {"Authorization": f"Bearer {body['scorer_token']}"}
    started = client.post(
        f"/matches/{body['id']}/innings",
        headers=headers,
        json={
            "innings_number": 1,
            "batting_team_id": "N",
            "bowling_team_id": "H",
            "striker_id": "n1",
            "non_striker_id": "n2",
            "opening_bowler_id": "h1",
        },
    )
    assert started.status_code == 200
    posted = client.post(
        f"/matches/{body['id']}/events",
        headers=headers,
        json={"events": [_ball()]},
    )
    assert posted.status_code == 200

    document = yaml.safe_load(OPENAPI.read_text())
    schema = document["components"]["schemas"]["Scorecard"]
    card = client.get(f"/m/{slug}/scorecard")
    assert card.status_code == 200
    _check(card.json(), schema, OPENAPI, document)


def _payload() -> dict[str, object]:
    return {
        "overs": 2,
        "teams": [
            {
                "id": "N",
                "name": "North End",
                "players": [{"id": "n1", "name": "Asha"}, {"id": "n2", "name": "Bilal"}],
            },
            {
                "id": "H",
                "name": "Harbour Lane",
                "players": [{"id": "h1", "name": "Chitra"}, {"id": "h2", "name": "Dev"}],
            },
        ],
        "toss_winner_team_id": "N",
        "toss_decision": "bat",
    }


def _ball() -> dict[str, object]:
    return {
        "client_uuid": "00000000-0000-4000-8000-0000000000d1",
        "seq": 1,
        "innings_number": 1,
        "striker_id": "n1",
        "non_striker_id": "n2",
        "bowler_id": "h1",
        "runs_bat": 4,
        "extra_type": None,
        "extra_runs": 0,
        "wicket_type": None,
        "dismissed_id": None,
        "fielder_id": None,
    }


def _check(value: Any, schema: dict[str, Any], base: Path, document: dict[str, Any]) -> None:
    if "$ref" in schema:
        target, next_base, next_document = _resolve(schema["$ref"], base, document)
        _check(value, target, next_base, next_document)
        return
    if "anyOf" in schema:
        errors: list[str] = []
        for option in schema["anyOf"]:
            try:
                _check(value, option, base, document)
            except SchemaError as exc:
                errors.append(str(exc))
            else:
                return
        raise SchemaError("; ".join(errors))
    if "const" in schema and value != schema["const"]:
        raise SchemaError(f"{value!r} is not {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise SchemaError(f"{value!r} is not in {schema['enum']}")
    kind = schema.get("type")
    if isinstance(kind, str) and not _is_type(value, kind):
        raise SchemaError(f"{value!r} is not {kind}")
    if kind == "string":
        if "minLength" in schema and len(value) < schema["minLength"]:
            raise SchemaError(f"{value!r} is shorter than {schema['minLength']}")
        if "pattern" in schema and re.search(schema["pattern"], value) is None:
            raise SchemaError(f"{value!r} does not match {schema['pattern']}")
    if kind in ("integer", "number"):
        if "minimum" in schema and value < schema["minimum"]:
            raise SchemaError(f"{value} is below {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            raise SchemaError(f"{value} is above {schema['maximum']}")
    if kind == "array":
        if "minItems" in schema and len(value) < schema["minItems"]:
            raise SchemaError("array is shorter than minItems")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            raise SchemaError("array is longer than maxItems")
        if "items" in schema:
            for item in value:
                _check(item, schema["items"], base, document)
    if kind == "object":
        if schema.get("additionalProperties") is False:
            extra = set(value) - set(schema.get("properties", {}))
            if extra:
                raise SchemaError(f"unexpected {sorted(extra)}")
        for key in schema.get("required", []):
            if key not in value:
                raise SchemaError(f"missing {key}")
        for key, child in schema.get("properties", {}).items():
            if key in value:
                _check(value[key], child, base, document)


def _resolve(
    ref: str,
    base: Path,
    document: dict[str, Any],
) -> tuple[dict[str, Any], Path, dict[str, Any]]:
    if ref.startswith("#"):
        return _pointer(document, ref), base, document
    file_part, _, pointer = ref.partition("#")
    path = (base.parent / file_part).resolve()
    loaded = json.loads(path.read_text())
    if not pointer:
        return loaded, path, loaded
    return _pointer(loaded, f"#{pointer}"), path, loaded


def _pointer(document: dict[str, Any], pointer: str) -> dict[str, Any]:
    node: Any = document
    for part in pointer.removeprefix("#/").split("/"):
        node = node[part]
    if not isinstance(node, dict):
        raise SchemaError(f"{pointer} is not an object schema")
    return node


def _is_type(value: object, kind: str) -> bool:
    if kind == "object":
        return isinstance(value, dict)
    if kind == "array":
        return isinstance(value, list)
    if kind == "string":
        return isinstance(value, str)
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "number":
        return (isinstance(value, int) or isinstance(value, float)) and not isinstance(value, bool)
    if kind == "null":
        return value is None
    raise SchemaError(f"unsupported type {kind}")
