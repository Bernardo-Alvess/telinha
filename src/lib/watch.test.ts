import { describe, expect, it } from "vitest";
import { addWatching, mosaicColumns, pruneWatching, removeWatching } from "./watch";

describe("watch list", () => {
  it("adds every live without dropping older ones", () => {
    expect(addWatching(["a"], "a")).toEqual(["a"]);
    expect(addWatching(["a"], "b")).toEqual(["a", "b"]);
    expect(addWatching(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(addWatching(["a", "b", "c"], "d")).toEqual(["a", "b", "c", "d"]);
  });

  it("removes and prunes ended lives", () => {
    expect(removeWatching(["a", "b"], "a")).toEqual(["b"]);
    expect(pruneWatching(["a", "b", "c"], ["b", "d"])).toEqual(["b"]);
  });

  it("picks a mosaic that fits one to many lives", () => {
    expect(mosaicColumns(1)).toBe(1);
    expect(mosaicColumns(2)).toBe(2);
    expect(mosaicColumns(3)).toBe(2);
    expect(mosaicColumns(4)).toBe(2);
    expect(mosaicColumns(5)).toBe(3);
    expect(mosaicColumns(9)).toBe(3);
    expect(mosaicColumns(10)).toBe(4);
  });
});
