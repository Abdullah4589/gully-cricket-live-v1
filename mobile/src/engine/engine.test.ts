import { deepStrictEqual, strictEqual } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { formatEconomy, formatStrikeRate } from "./present";
import { replayFixture, runInvalidFixture } from "./replay";
import type { InvalidFixture, ReplayFixture } from "./replay";

// mobile/src/engine is three levels below the repo root. The phone and the
// server both read this one contracts/fixtures directory. Do not copy it.
const fixturesRoot = join(__dirname, "..", "..", "..", "contracts", "fixtures");

const validNames = readdirSync(join(fixturesRoot, "valid"))
  .filter((name) => name.endsWith(".json"))
  .sort();
const invalidNames = readdirSync(join(fixturesRoot, "invalid"))
  .filter((name) => name.endsWith(".json"))
  .sort();

describe("scorecard rates", () => {
  it("shows a dash when no ball has been faced", () => {
    strictEqual(formatStrikeRate(4, 0), "-");
    strictEqual(formatEconomy(1, 0), "-");
  });

  it("rounds strike rate and economy like the scoring rates", () => {
    strictEqual(formatStrikeRate(10, 3), "333.33");
    strictEqual(formatEconomy(10, 11), "5.45");
    strictEqual(formatEconomy(6, 6), "6");
  });
});

describe("shared scoring fixtures", () => {
  it("reads every fixture file", () => {
    strictEqual(validNames.length > 0, true);
    strictEqual(invalidNames.length > 0, true);
    strictEqual(
      readdirSync(join(fixturesRoot, "valid")).filter((name) => name.endsWith(".json")).length,
      validNames.length,
    );
    strictEqual(
      readdirSync(join(fixturesRoot, "invalid")).filter((name) => name.endsWith(".json")).length,
      invalidNames.length,
    );
  });

  for (const name of validNames) {
    it(`valid ${name}`, () => {
      const fixture = JSON.parse(readFileSync(join(fixturesRoot, "valid", name), "utf8")) as ReplayFixture;
      const state = replayFixture(fixture);
      deepStrictEqual(state, fixture.expect);
      for (const innings of state.innings) {
        const pairs = innings.partnerships;
        strictEqual(
          pairs.reduce((sum, pair) => sum + pair.runs, 0),
          innings.runs,
        );
        strictEqual(
          pairs.reduce((sum, pair) => sum + pair.balls, 0),
          innings.batting.reduce((sum, row) => sum + row.balls, 0),
        );
        const scored = new Map<string, number>();
        for (const pair of pairs) {
          scored.set(pair.batter1_id, (scored.get(pair.batter1_id) ?? 0) + pair.batter1_runs);
          if (pair.batter2_id === null) {
            strictEqual(pair.batter2_runs, 0);
            strictEqual(pair.batter2_balls, 0);
          } else {
            scored.set(pair.batter2_id, (scored.get(pair.batter2_id) ?? 0) + pair.batter2_runs);
          }
        }
        for (const row of innings.batting) {
          strictEqual(scored.get(row.player_id) ?? 0, row.runs);
        }
      }
    });
  }

  for (const name of invalidNames) {
    it(`invalid ${name}`, () => {
      const fixture = JSON.parse(readFileSync(join(fixturesRoot, "invalid", name), "utf8")) as InvalidFixture;
      const outcome = runInvalidFixture(fixture);
      strictEqual(outcome.code, fixture.expect_error);
      deepStrictEqual(outcome.state, fixture.expect);
      deepStrictEqual(outcome.before, outcome.state);
    });
  }
});
