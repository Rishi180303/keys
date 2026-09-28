import { describe, expect, it } from "vitest";
import { buildScene } from "./scene";
import { makePlay } from "./testplays";
import { AIR_RATE, FPS, HOLD, LEAD_FRAMES, makeTimeline, stepFrame } from "./timeline";

const scene = buildScene(makePlay({ dir: "right", yl: 50, depth: 25, across: 14, nfo: 18 }));

describe("makeTimeline", () => {
  it("plays the lead in at real speed, the air in slow motion, then holds", () => {
    const tl = makeTimeline(scene);
    expect(tl.start).toBe(scene.nIn - 1 - LEAD_FRAMES < 0 ? 0 : scene.nIn - 1 - LEAD_FRAMES);
    expect(tl.tThrow).toBeCloseTo((tl.throwFrame - tl.start) / FPS);
    expect(tl.tArrive - tl.tThrow).toBeCloseTo(18 / (FPS * AIR_RATE));
    expect(tl.duration - tl.tArrive).toBeCloseTo(HOLD);
    expect(tl.frameAt(0)).toBe(tl.start);
    expect(tl.frameAt(tl.tThrow)).toBeCloseTo(tl.throwFrame);
    expect(tl.frameAt((tl.tThrow + tl.tArrive) / 2)).toBeCloseTo(tl.throwFrame + 9);
    expect(tl.frameAt(tl.duration)).toBe(tl.arriveFrame);
  });
  it("inverts frames to times and steps whole frames", () => {
    const tl = makeTimeline(scene);
    for (const f of [tl.start, tl.throwFrame, tl.throwFrame + 5, tl.arriveFrame]) expect(tl.frameAt(tl.timeAt(f))).toBeCloseTo(f);
    expect(tl.frameAt(stepFrame(tl, tl.timeAt(tl.throwFrame + 3.4), 1))).toBeCloseTo(tl.throwFrame + 4);
    expect(tl.frameAt(stepFrame(tl, tl.timeAt(tl.throwFrame + 3), -1))).toBeCloseTo(tl.throwFrame + 2);
    // from arrival a step forward goes to the end of the hold, where the caption shows, never backwards
    expect(stepFrame(tl, tl.tArrive, 1)).toBeCloseTo(tl.duration);
    expect(stepFrame(tl, tl.duration, 1)).toBeCloseTo(tl.duration);
    expect(tl.frameAt(stepFrame(tl, tl.duration, -1))).toBeCloseTo(tl.arriveFrame - 1);
    expect(stepFrame(tl, 0, -1)).toBe(0);
  });
  it("half speed doubles the lead in and the air but not the hold", () => {
    const one = makeTimeline(scene);
    const half = makeTimeline(scene, 0.5);
    expect(half.tArrive).toBeCloseTo(2 * one.tArrive);
    expect(half.duration - half.tArrive).toBeCloseTo(HOLD);
  });
});
