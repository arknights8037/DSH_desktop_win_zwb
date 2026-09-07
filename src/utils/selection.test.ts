import { describe, expect, it } from "vitest";
import { toggleSelection } from "./selection";

describe("toggleSelection", () => {
  it("adds and removes article ids", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  it("keeps only the newest ids within the agent limit", () => {
    expect(toggleSelection(["a", "b"], "c", 2)).toEqual(["b", "c"]);
  });
});
