import { describe, expect, it } from "vitest";
import { camera, CAMERAS, type Viewport } from "./cameras";
import { caption } from "./captions";
import { drawFrame, NIGHT } from "./draw";
import { buildScene } from "./scene";
import { makePlay } from "./testplays";
import { makeTimeline } from "./timeline";

/** A 2D context that records every method call and accepts every property. */
function recorder() {
  const calls: string[] = [];
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) =>
      key in target
        ? target[key]
        : (...args: unknown[]) => {
            calls.push(key);
            return key.startsWith("create") ? gradient : args.length ? undefined : undefined;
          },
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("drawFrame", () => {
  const scene = buildScene(makePlay({ dir: "left", yl: 60, depth: 30, across: 12 }));
  const tl = makeTimeline(scene);
  for (const name of CAMERAS)
    for (const vp of [{ w: 1280, h: 720 }, { w: 390, h: 693 }] as Viewport[])
      it(`draws every stage of the play with the ${name} camera at ${vp.w}x${vp.h}`, () => {
        for (const frame of [tl.start, tl.throwFrame, tl.throwFrame + 3.5, tl.arriveFrame]) {
          const { ctx, calls } = recorder();
          const whatIf = new Map([[3, [scene.land]]]);
          drawFrame(ctx, scene, camera(name, scene, frame, vp), frame, vp, NIGHT, { start: tl.start, arrive: frame === tl.arriveFrame ? 1 : 0, whatIf, editing: name === "overhead" });
          expect(calls[0]).toBe("fillRect");
          expect(calls).toContain("arc");
          expect(calls).toContain("fillText");
        }
      });
});

describe("caption", () => {
  const play = makePlay({ dir: "right", yl: 40, depth: 20, across: 30 });
  it("says how much closer or farther the featured defender got", () => {
    expect(caption(buildScene(play))).toEqual({ kind: "rated", who: "Cam Corner · CB · KC", yards: "1.50", line: "closer to the catch point than the model expected" });
    expect(caption(buildScene(play, 4))).toEqual({ kind: "rated", who: "Sam Safety · FS · KC", yards: "1.00", line: "farther from the catch point than the model expected" });
  });
  it("says why a play is not rated, and nothing without a rating", () => {
    const excluded = { ...play, ratings: [{ ...play.ratings[0], ex: "out of bounds" }] };
    expect(caption(buildScene(excluded))).toEqual({ kind: "unrated", who: "Cam Corner · CB · KC", line: "not rated: out of bounds" });
    expect(caption(buildScene({ ...play, ratings: [] }))).toBeNull();
  });
});
