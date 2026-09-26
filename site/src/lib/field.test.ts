import { describe, expect, it } from "vitest";
import { frameCount, inputFrames, positionAt } from "./field";
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
