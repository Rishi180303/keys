import { describe, expect, it } from "vitest";
import { blend, camera, CAMERAS, defaultCamera, perspective, screenNudge, type CameraName, type View, type Viewport } from "./cameras";
import { along, buildScene, type Pt, type Scene } from "./scene";
import { makePlay, shapes } from "./testplays";
import { makeTimeline } from "./timeline";

const WIDE: Viewport = { w: 1280, h: 720 };
const TALL: Viewport = { w: 390, h: 693 };

function outside(view: View, vp: Viewport, pts: Pt[]): Pt[] {
  const mx = 0.01 * vp.w;
  const my = 0.01 * vp.h;
  return pts.filter(([l, u]) => {
    const p = view.project(l, u);
    return !p || p[0] < mx || p[0] > vp.w - mx || p[1] < my || p[1] > vp.h - my;
  });
}

/** What each camera promises to keep in frame at a frame. */
function promised(name: CameraName, s: Scene, frame: number): Pt[] {
  const at = (a: Scene["passer"] | null) => (a ? [along(a.path, frame)] : []);
  const all = [...at(s.passer), ...at(s.target), ...s.defenders.flatMap(at), s.land];
  const ends = [...at(s.target), ...at(s.featured), s.land];
  const thrown = frame >= s.nIn - 1;
  if (name === "broadcast") return all;
  if (name === "overhead") return thrown ? ends : all;
  const tl = makeTimeline(s);
  if (Math.abs(frame - tl.throwFrame) < 1e-9) return [...at(s.passer), ...at(s.target)];
  if (Math.abs(frame - tl.arriveFrame) < 1e-9) return ends;
  return [];
}

describe("perspective", () => {
  it("puts the look at point in the middle of the screen and drops points behind the camera", () => {
    const { project, depth } = perspective([0, -10, 10], [0, 10, 0], 500, WIDE);
    expect(project(0, 10)).toEqual([expect.closeTo(640), expect.closeTo(360), expect.any(Number)]);
    expect(project(0, -30)).toBeNull();
    expect(depth(0, -30)).toBeLessThan(0);
    expect(project(5, 10)![0]).toBeGreaterThan(640);
  });
});

describe("framing", () => {
  // every shape, featuring the default defender and then the safety, who is often a help defender far from the ball
  const scenes = shapes().flatMap((s) => [
    { s, scene: buildScene(makePlay(s)) },
    { s: { ...s, featured: 4 }, scene: buildScene(makePlay(s), 4) },
  ]);
  for (const name of CAMERAS)
    for (const vp of [WIDE, TALL])
      it(`${name} keeps what it promises in frame, ${vp.w}x${vp.h}, over ${scenes.length} scenes`, () => {
        const misses: string[] = [];
        for (const { s, scene } of scenes) {
          const tl = makeTimeline(scene);
          const frames = [tl.throwFrame, tl.arriveFrame];
          for (let f = tl.start; f <= tl.arriveFrame; f += 0.5) frames.push(f);
          for (const frame of frames) {
            const out = outside(camera(name, scene, frame, vp), vp, promised(name, scene, frame));
            if (out.length) {
              misses.push(`${JSON.stringify(s)} frame ${frame}: ${JSON.stringify(out)}`);
              break;
            }
          }
        }
        expect(misses.slice(0, 5)).toEqual([]);
      });
  it("overhead in what if mode shows the whole width of the field, follows the spot, and inverts exactly", () => {
    const scene = buildScene(makePlay({ dir: "right", yl: 30, depth: 20, across: 10 }));
    for (const vp of [WIDE, TALL]) {
      const far: Pt = [30, 70];
      const view = camera("overhead", scene, scene.frames - 1, vp, far);
      expect(outside(view, vp, [[0, scene.land[1]], [53.3, scene.land[1]], far, scene.land])).toEqual([]);
      const [x, y] = view.project(12.5, 17.25)!;
      expect(view.unproject!(x, y)).toEqual([expect.closeTo(12.5), expect.closeTo(17.25)]);
    }
  });
});

describe("blend", () => {
  it("starts at one view, ends at the other, and passes through the middle", () => {
    const scene = buildScene(makePlay({ dir: "left", yl: 60, depth: 25, across: 30 }));
    const a = camera("broadcast", scene, 10, WIDE);
    const b = camera("overhead", scene, 10, WIDE);
    const pt: Pt = [30, 25];
    expect(blend(a, b, 0).project(...pt)).toEqual(a.project(...pt));
    expect(blend(a, b, 1).project(...pt)).toEqual(b.project(...pt));
    const mid = blend(a, b, 0.5).project(...pt)!;
    expect(mid[0]).toBeCloseTo((a.project(...pt)![0] + b.project(...pt)![0]) / 2);
    expect(blend(a, b, 0.5).unproject).toBe(b.unproject);
  });
});

describe("defaults and keys", () => {
  it("defaults to chase when the replay is taller than wide", () => {
    expect(defaultCamera(WIDE)).toBe("broadcast");
    expect(defaultCamera(TALL)).toBe("chase");
  });
  it("moves a point the way the arrow keys look on an overhead screen", () => {
    const scene = buildScene(makePlay({ dir: "right", yl: 30, depth: 20, across: 10 }));
    const wide = camera("overhead", scene, 0, WIDE, scene.land);
    const tall = camera("overhead", scene, 0, TALL, scene.land);
    expect(screenNudge(wide, [10, 20], "ArrowRight", false)).toEqual([10, 20.5]);
    expect(screenNudge(wide, [10, 20], "ArrowUp", true)).toEqual([5, 20]);
    expect(screenNudge(tall, [10, 20], "ArrowUp", false)).toEqual([10, 20.5]);
    expect(screenNudge(tall, [10, 20], "ArrowLeft", false)).toEqual([9.5, 20]);
    expect(screenNudge(wide, [10, 20], "Enter", false)).toBeNull();
    expect(screenNudge(camera("broadcast", scene, 0, WIDE), [10, 20], "ArrowUp", false)).toBeNull();
    // on screen, right really is right and up really is up
    const [x0, y0] = wide.project(10, 20)!;
    const [x1] = wide.project(...screenNudge(wide, [10, 20], "ArrowRight", false)!)!;
    const [, y1] = tall.project(...screenNudge(tall, [10, 20], "ArrowUp", false)!)!;
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeLessThan(tall.project(10, 20)![1]);
    expect(y0).toBeGreaterThan(0);
  });
});
