import { airAt, along, ballAt, ghostAt, type Pt, type Scene } from "./scene";
import { LEAD_FRAMES } from "./timeline";

export type CameraName = "broadcast" | "overhead" | "chase";
export const CAMERAS: CameraName[] = ["broadcast", "overhead", "chase"];
export type Viewport = { w: number; h: number };
/** screen x, screen y, and pixels per yard at that depth */
export type Projected = [number, number, number];

export type View = {
  flat: boolean;
  project: (l: number, u: number, z?: number) => Projected | null;
  /** a screen point back to the ground, flat views only */
  unproject: ((x: number, y: number) => Pt) | null;
  /** the downfield range worth drawing */
  uMin: number;
  uMax: number;
  /** flat views: which way downfield points on screen */
  downfield: "right" | "up" | null;
};

type V3 = [number, number, number];
type Box = { l0: number; l1: number; u0: number; u1: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** A pinhole camera at pos looking at tgt, +z up; points closer than a yard in front of it are null. */
export function perspective(pos: V3, tgt: V3, focal: number, vp: Viewport) {
  const f = norm(sub(tgt, pos));
  const r = norm(cross(f, [0, 0, 1]));
  const up = cross(r, f);
  return (l: number, u: number, z = 0): Projected | null => {
    const d = sub([l, u, z], pos);
    const zc = dot(d, f);
    if (zc < 1) return null;
    return [vp.w / 2 + (focal * dot(d, r)) / zc, vp.h / 2 - (focal * dot(d, up)) / zc, focal / zc];
  };
}

function boxOf(pts: Pt[], pad: number, minL: number, minU: number): Box {
  let [l0, l1, u0, u1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [l, u] of pts) {
    l0 = Math.min(l0, l);
    l1 = Math.max(l1, l);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
  }
  const grow = (a: number, b: number, min: number) => {
    const extra = Math.max(0, min - (b - a - 2 * pad)) / 2;
    return [a - pad - extra, b + pad + extra];
  };
  [l0, l1] = grow(l0, l1, minL);
  [u0, u1] = grow(u0, u1, minU);
  return { l0, l1, u0, u1 };
}

const memo = new WeakMap<Scene, Map<string, unknown>>();
function cached<T>(scene: Scene, key: string, make: () => T): T {
  let m = memo.get(scene);
  if (!m) memo.set(scene, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key) as T;
}

/** The points every camera must keep in frame: the passer, the target and the flagged defenders over the replay
 * window, the flagged players' expected paths, and the landing spot. */
export function keyPoints(scene: Scene): Pt[] {
  return cached(scene, "key", () => {
    const start = Math.max(0, scene.nIn - 1 - LEAD_FRAMES);
    const who = [scene.passer, ...(scene.target ? [scene.target] : []), ...scene.defenders];
    const pts: Pt[] = [scene.land];
    for (const a of who) {
      pts.push(...a.path.slice(start));
      if (a.ghost) pts.push(...a.ghost);
    }
    return pts;
  });
}

function broadcast(scene: Scene, frame: number, vp: Viewport): View {
  const focal = 0.62 * vp.w;
  // steeper on a tall screen, so the field fills the height instead of the sky
  const pitch = ((vp.h > vp.w ? 50 : 32) * Math.PI) / 180;
  const setup = cached(scene, `b${vp.w}x${vp.h}`, () => {
    const pts = keyPoints(scene);
    const box = boxOf(pts, 0, 0, 0);
    const lc = (box.l0 + box.l1) / 2;
    const uc = (box.u0 + box.u1) / 2;
    // the ball's highest point stays in frame too
    const apex = ballAt(scene, scene.nIn - 1 + scene.nfo / 2);
    const test: V3[] = [...pts.map(([l, u]): V3 => [l, u, 0]), apex];
    const at = (d: number) => perspective([lc, uc - d * Math.cos(pitch), d * Math.sin(pitch)], [lc, uc, 0], focal, vp);
    const fits = (d: number) => {
      const p = at(d);
      const mx = 0.08 * vp.w;
      const my = 0.08 * vp.h;
      return test.every(([l, u, z]) => {
        const q = p(l, u, z);
        return q !== null && q[0] >= mx && q[0] <= vp.w - mx && q[1] >= my && q[1] <= vp.h - my;
      });
    };
    let [lo, hi] = [5, 800];
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return { lc, uc, d: hi, box };
  });
  // a slow push in while the ball is in the air
  const d = setup.d * (1 - 0.03 * ease(airAt(scene, frame)));
  const pos: V3 = [setup.lc, setup.uc - d * Math.cos(pitch), d * Math.sin(pitch)];
  return {
    flat: false,
    project: perspective(pos, [setup.lc, setup.uc, 0], focal, vp),
    unproject: null,
    uMin: Math.max(setup.box.u0 - 25, pos[1] + 2),
    uMax: setup.box.u1 + 45,
    downfield: null,
  };
}

function chase(scene: Scene, frame: number, vp: Viewport): View {
  const focal = 0.62 * vp.w;
  // a tall screen looks down more steeply, so the field fills it instead of the sky
  const tall = vp.h > vp.w;
  const throwF = scene.nIn - 1;
  const q = along(scene.passer.path, Math.min(frame, throwF));
  const tq = scene.target ? along(scene.target.path, throwF) : scene.land;
  // behind the passer, far enough back to see the target at the throw
  const back = Math.max(13, Math.abs(tq[0] - q[0]) * 0.7);
  const pos0: V3 = [q[0], q[1] - back, tall ? 10 : 6.5];
  const look0: V3 = [lerp(q[0], tq[0], 0.5), q[1] + 18, 0];
  // at arrival: centered on the landing spot, the target and the featured defender, far enough back for all three
  const end = [scene.land, ...(scene.target ? [scene.target.path[scene.frames - 1]] : []), ...(scene.featured ? [scene.featured.path[scene.frames - 1]] : [])];
  const cl = end.reduce((a, p) => a + p[0], 0) / end.length;
  const cu = end.reduce((a, p) => a + p[1], 0) / end.length;
  const spreadL = Math.max(...end.map((p) => Math.abs(p[0] - cl)));
  const dist = Math.max(19, spreadL * 2.4);
  const pos1: V3 = [lerp(q[0], cl, 0.75), cu - dist, tall ? 18 : 11];
  const look1: V3 = [cl, cu + 2, 0];
  const e = ease(airAt(scene, frame));
  const pos: V3 = [lerp(pos0[0], pos1[0], e), lerp(pos0[1], pos1[1], e), lerp(pos0[2], pos1[2], e)];
  const look: V3 = [lerp(look0[0], look1[0], e), lerp(look0[1], look1[1], e), 0];
  return { flat: false, project: perspective(pos, look, focal, vp), unproject: null, uMin: pos[1] + 2, uMax: pos[1] + 90, downfield: null };
}

function overhead(scene: Scene, frame: number, vp: Viewport, whatIf: boolean): View {
  const right = vp.w >= vp.h;
  const full = cached(scene, "ofull", () => boxOf(keyPoints(scene), 5, 20, 25));
  let box = full;
  if (whatIf) {
    // the whole width of the field and room downfield, so a dragged spot always has somewhere to go
    box = { l0: -2, l1: 55.3, u0: full.u0, u1: Math.max(full.u1, scene.land[1] + 15) };
  } else {
    const s = ease(airAt(scene, frame));
    if (s > 0) {
      const ends = [scene.land, ...(scene.target ? [scene.target.path[scene.frames - 1]] : [])];
      if (scene.featured) ends.push(scene.featured.path[scene.frames - 1], ghostAt(scene.featured, scene, scene.frames - 1) ?? scene.land);
      const air = cached(scene, "oair", () => boxOf(ends, 6, 18, 22));
      box = { l0: lerp(full.l0, air.l0, s), l1: lerp(full.l1, air.l1, s), u0: lerp(full.u0, air.u0, s), u1: lerp(full.u1, air.u1, s) };
    }
  }
  const m = 0.06;
  const [spanX, spanY] = right ? [box.u1 - box.u0, box.l1 - box.l0] : [box.l1 - box.l0, box.u1 - box.u0];
  const sc = Math.min((vp.w * (1 - 2 * m)) / spanX, (vp.h * (1 - 2 * m)) / spanY);
  const lc = (box.l0 + box.l1) / 2;
  const uc = (box.u0 + box.u1) / 2;
  const project = (l: number, u: number, z = 0): Projected =>
    right
      ? [vp.w / 2 + (u - uc) * sc, vp.h / 2 + (l - lc) * sc - z * sc * 0.35, sc * (1 + z * 0.025)]
      : [vp.w / 2 + (l - lc) * sc, vp.h / 2 - (u - uc) * sc - z * sc * 0.35, sc * (1 + z * 0.025)];
  const unproject = (x: number, y: number): Pt => (right ? [lc + (y - vp.h / 2) / sc, uc + (x - vp.w / 2) / sc] : [lc + (x - vp.w / 2) / sc, uc - (y - vp.h / 2) / sc]);
  const half = (right ? vp.w : vp.h) / 2 / sc;
  return { flat: true, project, unproject, uMin: uc - half - 1, uMax: uc + half + 1, downfield: right ? "right" : "up" };
}

/** The view a camera has of a scene at a frame in a viewport. whatIf holds the overhead framing still and wide. */
export function camera(name: CameraName, scene: Scene, frame: number, vp: Viewport, whatIf = false): View {
  if (name === "overhead") return overhead(scene, frame, vp, whatIf);
  if (name === "chase") return chase(scene, frame, vp);
  return broadcast(scene, frame, vp);
}

/** The camera a replay uses when the viewer has not picked one: chase when it is taller than wide. */
export const defaultCamera = (vp: Viewport): CameraName => (vp.h > vp.w ? "chase" : "broadcast");

/** An arrow key moves a point on a flat view the way it looks on screen: half a yard, five with shift. */
export function screenNudge(view: View, p: Pt, key: string, shift: boolean): Pt | null {
  const step = shift ? 5 : 0.5;
  const right = view.downfield === "right";
  const moves: Record<string, Pt> = right
    ? { ArrowRight: [0, step], ArrowLeft: [0, -step], ArrowUp: [-step, 0], ArrowDown: [step, 0] }
    : { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  const d = view.flat ? moves[key] : undefined;
  return d ? [p[0] + d[0], p[1] + d[1]] : null;
}
