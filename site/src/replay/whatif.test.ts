import { describe, expect, it } from "vitest";
import { buildScene } from "./scene";
import { makePlay } from "./testplays";
import { clampLand, whatIfPaths } from "./whatif";

const scene = buildScene(makePlay({ dir: "left", yl: 60, depth: 20, across: 10 }));

describe("whatIfPaths", () => {
  it("groups the answer by player, orders frames and converts to scene coordinates", () => {
    const paths = whatIfPaths(scene, {
      model: "m",
      predictions: [
        { nfl_id: 3, frame_id: 2, x: 40, y: 12, sd_x: 1, sd_y: 1 },
        { nfl_id: 3, frame_id: 1, x: 41, y: 11, sd_x: 1, sd_y: 1 },
        { nfl_id: 2, frame_id: 1, x: 42, y: 10, sd_x: 1, sd_y: 1 },
      ],
    });
    expect([...paths.keys()].sort()).toEqual([2, 3]);
    expect(paths.get(3)).toEqual([scene.toScene(41, 11), scene.toScene(40, 12)]);
  });
});

describe("clampLand", () => {
  it("keeps the spot within five yards of the field, whichever way the offense goes", () => {
    expect(scene.toField(clampLand(scene, scene.toScene(130, -9)))).toEqual([125, -5]);
    expect(scene.toField(clampLand(scene, scene.toScene(30.123, 20.456)))).toEqual([expect.closeTo(30.12), expect.closeTo(20.46)]);
  });
});
