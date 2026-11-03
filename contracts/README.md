# Scoring contract

This directory is the shared scoring contract for Gully Cricket Live. The mobile client and the API server both implement `RULES.md` and prove it by running these fixtures. Do not add a translation layer: the same JSON keys, tokens, dismissal strings, and error codes cross the boundary.

Normative files:

- `RULES.md` — engine behavior, including the fixture runner
- `data-model.md` — logical tables; the ball log is the source of truth
- `openapi.yaml` — HTTP and the read-only websocket
- `schemas/ball-event.schema.json` — one ball
- `schemas/match-state.schema.json` — derived state (`expect`)

## Fixtures

Load every `fixtures/valid/*.json`. Apply `setup`, then `innings` and `ops` exactly as `RULES.md` describes (an innings starts lazily on the first ball that needs it; `undo` voids the highest non-voided `seq` and replays). The derived state must deep-equal `expect`. Compare parsed values. `5.45` is a number. `6` and `6.0` are the same number.

Load every `fixtures/invalid/*.json`. After `ops`, start the innings the `illegal` ball needs if it is not already started. Applying that ball must fail with `expect_error` and must not change the state. The state must deep-equal `expect`.

Schema checks are necessary and not sufficient. A structurally valid ball can still be `wide_with_bat_runs`.

Omitted `rules` keys default to `wide_runs` 1, `no_ball_runs` 1, and `last_man_stands` true. The fixtures send the resolved object. The engine in `expect.rules` always has all three keys.

## Python

```python
import json
from pathlib import Path

for path in sorted(Path("contracts/fixtures/valid").glob("*.json")):
    fixture = json.loads(path.read_text())
    assert engine(fixture) == fixture["expect"]

for path in sorted(Path("contracts/fixtures/invalid").glob("*.json")):
    fixture = json.loads(path.read_text())
    before = engine_until_illegal(fixture)
    assert before == fixture["expect"]
    try:
        engine_apply(before, fixture["illegal"]["event"])
    except ScoringError as exc:
        assert exc.code == fixture["expect_error"]
        assert engine_state() == before
    else:
        raise AssertionError(path.name)
```

## TypeScript

```ts
import { readdirSync, readFileSync } from "node:fs";

for (const name of readdirSync("contracts/fixtures/valid").sort()) {
  const fixture = JSON.parse(readFileSync(`contracts/fixtures/valid/${name}`, "utf8"));
  assert.deepStrictEqual(engine(fixture), fixture.expect);
}
```

Use the same pattern for `contracts/fixtures/invalid`: the thrown code equals `expect_error`, and a deep-equal of the state before and after the illegal ball succeeds. `assert.deepStrictEqual` on the parsed objects is the check. Do not reshape cards, rates, or tokens before comparing.
