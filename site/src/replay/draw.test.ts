import { describe, expect, it } from "vitest";
import { camera, CAMERAS, perspective, type View, type Viewport } from "./cameras";
import { caption, surname } from "./captions";
import { clipPolygon, clipSegment, drawFrame, NIGHT } from "./draw";
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
          const arrive = frame === tl.arriveFrame ? 1 : 0;
          drawFrame(ctx, scene, camera(name, scene, frame, vp), frame, vp, NIGHT, { start: tl.start, arrive, whatIf, editing: name === "overhead" });
          // the background first, then the turf under everything, then players, names over players
          expect(calls[0]).toBe("fillRect");
          const firstArc = calls.indexOf("arc");
          expect(calls.indexOf("fill")).toBeGreaterThan(0);
          expect(calls.indexOf("fill")).toBeLessThan(firstArc);
          expect(calls.lastIndexOf("fillText")).toBeGreaterThan(firstArc);
          // at arrival the spread ellipse and the gap line are drawn over the players
          if (arrive) expect(calls.lastIndexOf("ellipse")).toBeGreaterThan(firstArc);
        }
      });
});

describe("clipping at the camera", () => {
  const vp = { w: 1280, h: 720 };
  const { project, depth } = perspective([26, 0, 5], [26, 20, 0], 700, vp);
  const view: View = { flat: false, project, depth, unproject: null, uMin: -60, uMax: 100, downfield: null };
  it("cuts a line that passes behind the camera instead of dropping it", () => {
    const seg = clipSegment(view, [0, -20], [0, 40])!;
    expect(seg[1]).toEqual([0, 40]);
    expect(depth(...seg[0])).toBeCloseTo(1.01);
    expect(project(...seg[0])).not.toBeNull();
    expect(clipSegment(view, [0, -30], [10, -25])).toBeNull();
  });
  it("cuts the turf to what is in front of the camera", () => {
    const turf = clipPolygon(view, [[0, -20], [53.3, -20], [53.3, 60], [0, 60]]);
    expect(turf.length).toBeGreaterThanOrEqual(4);
    for (const [l, u] of turf) expect(depth(l, u)).toBeGreaterThanOrEqual(1.0099);
  });
  it("draws the turf even when the camera stands on the field", () => {
    const scene = buildScene(makePlay({ dir: "left", yl: 60, depth: 30, across: 2 }));
    const { ctx, calls } = recorder();
    drawFrame(ctx, scene, camera("chase", scene, 0, vp), 0, vp, NIGHT, { start: 0, arrive: 0 });
    expect(calls.indexOf("fill")).toBeGreaterThan(0);
  });
});

describe("surname", () => {
  it("labels players by surname without suffixes, keeping two word surnames", () => {
    expect(surname("Pat Surtain II")).toBe("SURTAIN");
    expect(surname("Chris Godwin Jr.")).toBe("GODWIN");
    expect(surname("Kenneth Murray, Jr.")).toBe("MURRAY");
    expect(surname("Deebo Samuel Sr.")).toBe("SAMUEL");
    expect(surname("Amon-Ra St. Brown")).toBe("ST. BROWN");
    expect(surname("Leighton Vander Esch")).toBe("VANDER ESCH");
    expect(surname("Andrew Van Ginkel")).toBe("VAN GINKEL");
    expect(surname("DaRon Bland")).toBe("BLAND");
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
