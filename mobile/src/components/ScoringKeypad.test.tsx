import { fireEvent, render } from "@testing-library/react-native";

import { ScoringKeypad } from "./ScoringKeypad";

describe("ScoringKeypad", () => {
  it("run controls call the scoring handler", async () => {
    const onScore = jest.fn();
    const view = await render(<ScoringKeypad onScore={onScore} />);

    fireEvent.press(view.getByTestId("score-0"));
    fireEvent.press(view.getByTestId("score-1"));
    fireEvent.press(view.getByTestId("score-4"));
    fireEvent.press(view.getByTestId("score-wide"));
    fireEvent.press(view.getByTestId("score-wicket"));

    expect(onScore).toHaveBeenNthCalledWith(1, { type: "runs", runs: 0 });
    expect(onScore).toHaveBeenNthCalledWith(2, { type: "runs", runs: 1 });
    expect(onScore).toHaveBeenNthCalledWith(3, { type: "runs", runs: 4 });
    expect(onScore).toHaveBeenNthCalledWith(4, { type: "wide" });
    expect(onScore).toHaveBeenNthCalledWith(5, { type: "wicket" });
  });
});
