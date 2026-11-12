import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react-native";

import { createMatch, replayFixture } from "../../../engine";
import type { ReplayFixture } from "../../../engine";
import { useMatchStore } from "../../../store/match-store";
import ScorecardScreen from "./scorecard";
import ScoringScreen from "./index";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: "local-1" }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../db/database", () => ({
  loadMatch: jest.fn(),
  readPublicSlug: jest.fn(),
  scoreBall: jest.fn(),
  startNextInnings: jest.fn(),
  undoBall: jest.fn(),
}));

const fixturePath = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "contracts",
  "fixtures",
  "valid",
  "partnership-run-out-change.json",
);

function loadPartnership() {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as ReplayFixture;
  return { doc: createMatch(fixture.setup), state: replayFixture(fixture) };
}

describe("match pages", () => {
  beforeEach(() => {
    const loaded = loadPartnership();
    useMatchStore.setState({
      localId: "local-1",
      doc: loaded.doc,
      state: loaded.state,
      publicSlug: null,
      loading: false,
      error: null,
      pendingCrease: null,
      pendingBowlerId: null,
    });
  });

  it("shows the crease and the first-innings rate on the live view", async () => {
    const view = await render(<ScoringScreen />);
    const crease = view.getByTestId("crease");
    expect(crease).toHaveTextContent(/Striker\s+A2\s+6 \(3\)\s+SR 200/);
    expect(crease).toHaveTextContent(/Non-striker\s+A3\s+6 \(1\)\s+SR 600/);
    expect(crease).toHaveTextContent(/Bowler\s+B1\s+1\.0-0-18-0\s+Econ 18/);
    expect(crease).toHaveTextContent(/Partnership\s+7 \(2\)/);
    expect(view.getByTestId("live-rates")).toHaveTextContent(/^CRR 18$/);
    expect(view.getByTestId("live-rates")).not.toHaveTextContent("RRR");
  });

  it("shows toss, columns, and partnerships on the scorecard", async () => {
    const view = await render(<ScorecardScreen />);
    expect(view.getByTestId("toss-line")).toHaveTextContent("A won the toss and chose to bat");
    expect(view.getByText(/CRR 18/)).toBeTruthy();
    expect(view.getByText("4s")).toBeTruthy();
    expect(view.getByText("6s")).toBeTruthy();
    expect(view.getByText("SR")).toBeTruthy();
    expect(view.getByText("Econ")).toBeTruthy();

    expect(view.getByTestId("batter-a1")).toHaveTextContent(/A1run out \(B2\)5210250/);
    expect(view.getByTestId("batter-a2")).toHaveTextContent(/A2not out6310200/);
    expect(view.getByTestId("batter-a3")).toHaveTextContent(/A3not out6101600/);
    expect(view.getByTestId("bowler-b1")).toHaveTextContent(/B11\.0018018/);

    expect(view.getByTestId("partnership-1")).toHaveTextContent("1  A1 5 (2), A2 5 (2)  11 (4)");
    expect(view.getByTestId("partnership-2")).toHaveTextContent("2  A2 1 (1), A3 6 (1)  7 (2)");
  });
});
