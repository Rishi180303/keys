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
  /** distance in front of the camera (perspective views), so lines can be cut where they pass behind it */
  depth: ((l: number, u: number, z?: number) => number) | null;
  /** a screen point back to the ground, flat views only */
  unproject: ((x: number, y: number) => Pt) | null;
  /** the downfield range worth drawing */
  uMin: number;
  uMax: number;
  /** flat views: which way downfield points on screen */
  downfield: "right" | "up" | null;
};

/** Points closer to a perspective camera than this, in yards, are not drawn. */
export const NEAR = 1;
/** The margin every fitted camera keeps around what it promises to show, as a share of the screen. */
const MARGIN = 0.08;

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

/** A pinhole camera at pos looking at tgt, +z up; points closer than NEAR in front of it project to null. */
export function perspective(pos: V3, tgt: V3, focal: number, vp: Viewport) {
  const f = norm(sub(tgt, pos));
  const r = norm(cross(f, [0, 0, 1]));
  const up = cross(r, f);
  const depth = (l: number, u: number, z = 0) => dot(sub([l, u, z], pos), f);
  const project = (l: number, u: number, z = 0): Projected | null => {
    const d = sub([l, u, z], pos);
    const zc = dot(d, f);
    if (zc < NEAR) return null;
    return [vp.w / 2 + (focal * dot(d, r)) / zc, vp.h / 2 - (focal * dot(d, up)) / zc, focal / zc];
  };
  return { project, depth };
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

/** A camera looking at `at` from behind (smaller u) at a fixed pitch, pulled back until every point fits with the
 * margin. Returns the distance; the search is over a range where fitting only gets easier with distance. */
function fit(at: V3, pitch: number, focal: number, vp: Viewport, pts: V3[], min: number): number {
  const place = (d: number) => perspective([at[0], at[1] - d * Math.cos(pitch), at[2] + d * Math.sin(pitch)], at, focal, vp).project;
  const fits = (d: number) => {
    const p = place(d);
    return pts.every(([l, u, z]) => {
      const q = p(l, u, z);
      return q !== null && q[0] >= MARGIN * vp.w && q[0] <= vp.w * (1 - MARGIN) && q[1] >= MARGIN * vp.h && q[1] <= vp.h * (1 - MARGIN);
    });
  };
  let [lo, hi] = [min, 1000];
  if (fits(lo)) return lo;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

const centerOf = (pts: Pt[]): V3 => {
  const b = boxOf(pts, 0, 0, 0);
  return [(b.l0 + b.l1) / 2, (b.u0 + b.u1) / 2, 0];
};
const eye = (at: V3, pitch: number, d: number): V3 => [at[0], at[1] - d * Math.cos(pitch), d * Math.sin(pitch)];
const ground = (pts: Pt[]): V3[] => pts.map(([l, u]): V3 => [l, u, 0]);
const rad = (deg: number) => (deg * Math.PI) / 180;

/** The broadcast camera's least distance from what it looks at, in yards. */
export const BROADCAST_MIN = 30;

function broadcast(scene: Scene, frame: number, vp: Viewport): View {
  const focal = 0.62 * vp.w;
  // steeper on a tall screen, so the field fills the height instead of the sky
  const pitch = rad(vp.h > vp.w ? 50 : 32);
  const setup = cached(scene, `b${vp.w}x${vp.h}`, () => {
    const pts = keyPoints(scene);
    const at = centerOf(pts);
    // the ball's highest point stays in frame too; never closer than BROADCAST_MIN, so a short throw is framed
    // like television, about fifty yards across, instead of a close up where the nearest players fill the screen
    const d = fit(at, pitch, focal, vp, [...ground(pts), ballAt(scene, scene.nIn - 1 + scene.nfo / 2)], BROADCAST_MIN);
    return { at, d, box: boxOf(pts, 0, 0, 0) };
  });
  // a slow push in while the ball is in the air
  const pos = eye(setup.at, pitch, setup.d * (1 - 0.03 * ease(airAt(scene, frame))));
  return { flat: false, ...perspective(pos, setup.at, focal, vp), unproject: null, uMin: pos[1] - 60, uMax: setup.box.u1 + 45, downfield: null };
}

function chase(scene: Scene, frame: number, vp: Viewport): View {
  const focal = 0.62 * vp.w;
  const tall = vp.h > vp.w;
  const throwF = scene.nIn - 1;
  const last = scene.frames - 1;
  const poses = cached(scene, `c${vp.w}x${vp.h}`, () => {
    // at the throw: low behind the passer, looking toward the target, far enough back for both
    const qT = along(scene.passer.path, throwF);
    const tq = scene.target ? along(scene.target.path, throwF) : scene.land;
    const start: V3 = [lerp(qT[0], tq[0], 0.5), lerp(qT[1], tq[1], 0.35), 0];
    const p0 = rad(tall ? 30 : 16);
    const d0 = fit(start, p0, focal, vp, ground([qT, tq]), 12);
    // at arrival: higher, over the landing spot, the target, the featured defender and where he was expected
    const ends: Pt[] = [scene.land];
    if (scene.target) ends.push(scene.target.path[last]);
    if (scene.featured) ends.push(scene.featured.path[last], ghostAt(scene.featured, scene, last) ?? scene.land);
    const end = centerOf(ends);
    const p1 = rad(tall ? 46 : 28);
    const d1 = fit(end, p1, focal, vp, ground(ends), 16);
    return { qT, start, from: eye(start, p0, d0), end, to: eye(end, p1, d1) };
  });
  // before the throw the camera rides along with the passer
  const q = along(scene.passer.path, Math.min(frame, throwF));
  const shift: V3 = [q[0] - poses.qT[0], q[1] - poses.qT[1], 0];
  const e = ease(airAt(scene, frame));
  const mix = (a: V3, b: V3): V3 => [lerp(a[0] + shift[0] * (1 - e), b[0], e), lerp(a[1] + shift[1] * (1 - e), b[1], e), lerp(a[2], b[2], e)];
  const pos = mix(poses.from, poses.to);
  return { flat: false, ...perspective(pos, mix(poses.start, poses.end), focal, vp), unproject: null, uMin: pos[1] - 60, uMax: pos[1] + 120, downfield: null };
}

function overhead(scene: Scene, frame: number, vp: Viewport, whatIf: Pt | null): View {
  const right = vp.w >= vp.h;
  const full = cached(scene, "ofull", () => boxOf(keyPoints(scene), 5, 20, 25));
  let box = full;
  if (whatIf) {
    // the whole width of the field, and wherever the what if spot has been put, with room around it
    box = { l0: -2, l1: 55.3, u0: Math.min(full.u0, whatIf[1] - 12), u1: Math.max(full.u1, scene.land[1] + 15, whatIf[1] + 15) };
  } else {
    const s = ease(airAt(scene, frame));
    if (s > 0) {
      const air = cached(scene, "oair", () => {
        const ends = [scene.land, ...(scene.target ? [scene.target.path[scene.frames - 1]] : [])];
        if (scene.featured) ends.push(scene.featured.path[scene.frames - 1], ghostAt(scene.featured, scene, scene.frames - 1) ?? scene.land);
        return boxOf(ends, 6, 18, 22);
      });
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
  return { flat: true, project, depth: null, unproject, uMin: uc - half - 1, uMax: uc + half + 1, downfield: right ? "right" : "up" };
}

/** The view a camera has of a scene at a frame in a viewport. A what if spot holds the overhead framing still, wide,
 * and around the spot. */
export function camera(name: CameraName, scene: Scene, frame: number, vp: Viewport, whatIf: Pt | null = null): View {
  if (name === "overhead") return overhead(scene, frame, vp, whatIf);
  if (name === "chase") return chase(scene, frame, vp);
  return broadcast(scene, frame, vp);
}

/** Part way from one view to another, 0 to 1, by blending where each puts every point on screen: switching cameras
 * glides instead of cutting. */
export function blend(a: View, b: View, k: number): View {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return {
    flat: k < 0.5 ? a.flat : b.flat,
    project: (l, u, z = 0) => {
      const p = a.project(l, u, z);
      const q = b.project(l, u, z);
      if (!p || !q) return k < 0.5 ? p : q;
      return [lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)];
    },
    depth: a.depth && b.depth ? (l, u, z = 0) => Math.min(a.depth!(l, u, z), b.depth!(l, u, z)) : (a.depth ?? b.depth),
    unproject: b.unproject,
    uMin: Math.min(a.uMin, b.uMin),
    uMax: Math.max(a.uMax, b.uMax),
    downfield: b.downfield,
  };
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
