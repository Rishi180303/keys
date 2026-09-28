import { describe, expect, it } from "vitest";
import { clampSpot, FIELD_X, FIELD_Y, frameCount, inputFrames, nudge, positionAt } from "./field";
import type { GamePlayer, Play } from "./types";

const player = (over: Partial<GamePlayer>): GamePlayer => ({
  id: 1, name: "A", pos: "CB", side: "Defense", role: "Defensive Coverage", h: "6-0", w: 200, b: "2000-01-01", p: false,
  in: [[1, 1, 0, 0, 0, 0], [2, 2, 0, 0, 0, 0]], ...over,
});

describe("positionAt", () => {
  it("walks the input frames, then the actual frames, then holds the last actual frame", () => {
    const p = player({ p: true, out: [[3, 3], [4, 4]] });
    expect([0, 1, 2, 3, 9].map((t) => positionAt(p, t))).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [4, 4]]);
  });
  it("holds a player without actual frames at his last input position", () => {
    expect(positionAt(player({}), 5)).toEqual([2, 2]);
  });
});

describe("frameCount", () => {
  it("is the longest input plus the frames in the air", () => {
    const play = { nfo: 6, players: [player({}), player({ id: 2, in: [[0, 0, 0, 0, 0, 0]] })] } as unknown as Play;
    expect(inputFrames(play)).toBe(2);
    expect(frameCount(play)).toBe(8);
  });
});

describe("nudge", () => {
  it("moves half a yard per arrow, five with shift, up is smaller y", () => {
    expect(nudge([64.5, 20], "ArrowRight", false)).toEqual([65, 20]);
    expect(nudge([64.5, 20], "ArrowLeft", true)).toEqual([59.5, 20]);
    expect(nudge([64.5, 20], "ArrowUp", false)).toEqual([64.5, 19.5]);
    expect(nudge([64.37, 20], "ArrowDown", true)).toEqual([64.37, 25]);
  });
  it("clamps like a drag and ignores other keys", () => {
    expect(nudge([FIELD_X + 4, 1], "ArrowRight", true)).toEqual([FIELD_X + 5, 1]);
    expect(nudge([10, -4.8], "ArrowUp", false)).toEqual([10, -5]);
    expect(nudge([10, 10], "Enter", false)).toBeNull();
  });
});

describe("clampSpot", () => {
  it("keeps a dragged or keyed landing spot within five yards of the field", () => {
    expect(clampSpot(-9, FIELD_X)).toBe(-5);
    expect(clampSpot(130, FIELD_X)).toBe(FIELD_X + 5);
    expect(clampSpot(20.5, FIELD_Y)).toBe(20.5);
    expect(clampSpot(60, FIELD_Y)).toBe(FIELD_Y + 5);
  });
});
