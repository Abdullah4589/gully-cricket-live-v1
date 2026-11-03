import { deepStrictEqual, strictEqual } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
      deepStrictEqual(replayFixture(fixture), fixture.expect);
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
