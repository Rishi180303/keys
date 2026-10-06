import { NEAR, type Viewport, type View } from "./cameras";
import { surname } from "./captions";
import { airAt, along, ballAt, FIELD_W, ghostAt, type Pt, type Scene } from "./scene";

export type Theme = {
  bg: string;
  turfNear: string;
  turfFar: string;
  endZone: string;
  /** the ground past the end lines and sidelines, so a goal line play is not drawn against the void */
  apron: string;
  /** r,g,b of the field markings */
  line: string;
  number: string;
  los: string;
  firstDown: string;
  offense: string;
  defense: string;
  featured: string;
  target: string;
  ghost: string;
  ball: string;
  land: string;
  whatIf: string;
  display: string;
};

export const NIGHT: Theme = {
  bg: "#05070a",
  turfNear: "#111a23",
  turfFar: "#0a1016",
  endZone: "rgba(56,189,248,.05)",
  apron: "#0a0f15",
  line: "148,163,184",
  number: "rgba(203,213,225,.28)",
  los: "#3b82f6",
  firstDown: "#facc15",
  offense: "#f1f5f9",
  defense: "#60a5fa",
  featured: "#7dd3fc",
  target: "#ffffff",
  ghost: "rgba(255,255,255,.72)",
  ball: "#fbbf24",
  land: "#f59e0b",
  whatIf: "#f0abfc",
  display: "'Barlow Condensed', system-ui, sans-serif",
};

export type Overlays = {
  /** the first frame of the replay, where trails begin */
  start: number;
  /** 0 to 1, how far the arrival marks have faded in */
  arrive: number;
  /** what if paths per player id, in scene coordinates, and the what if landing spot */
  whatIf?: Map<number, Pt[]> | null;
  land?: Pt | null;
  /** the landing ring can be dragged */
  editing?: boolean;
};

type Ctx = CanvasRenderingContext2D;
const HASH = 23.58;

const CUT = NEAR + 0.01;

/** A ground segment cut where it passes behind a perspective camera, or null when all of it is behind. */
export function clipSegment(view: View, a: Pt, b: Pt): [Pt, Pt] | null {
  if (!view.depth) return [a, b];
  const da = view.depth(a[0], a[1]) - CUT;
  const db = view.depth(b[0], b[1]) - CUT;
  if (da < 0 && db < 0) return null;
  if (da >= 0 && db >= 0) return [a, b];
  const t = da / (da - db);
  const c: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return da < 0 ? [c, b] : [a, c];
}

/** A ground polygon cut to the part in front of a perspective camera. */
export function clipPolygon(view: View, pts: Pt[]): Pt[] {
  if (!view.depth) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const da = view.depth(a[0], a[1]) - CUT;
    const db = view.depth(b[0], b[1]) - CUT;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function line(ctx: Ctx, view: View, a: Pt, b: Pt) {
  const seg = clipSegment(view, a, b);
  const p = seg && view.project(seg[0][0], seg[0][1]);
  const q = seg && view.project(seg[1][0], seg[1][1]);
  if (!p || !q) return;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  ctx.lineTo(q[0], q[1]);
  ctx.stroke();
}

function path(ctx: Ctx, view: View, pts: Pt[]) {
  ctx.beginPath();
  let at: Pt | null = null;
  for (let i = 1; i < pts.length; i++) {
    const seg = clipSegment(view, pts[i - 1], pts[i]);
    const p = seg && view.project(seg[0][0], seg[0][1]);
    const q = seg && view.project(seg[1][0], seg[1][1]);
    if (!p || !q) {
      at = null;
      continue;
    }
    if (!at || at[0] !== seg![0][0] || at[1] !== seg![0][1]) ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    at = seg![1];
  }
  ctx.stroke();
}

/** Fill a ground polygon, cut to what is in front of the camera. */
function fillGround(ctx: Ctx, view: View, pts: Pt[]) {
  const shown = clipPolygon(view, pts)
    .map(([l, u]) => view.project(l, u))
    .filter((p) => p !== null);
  if (shown.length < 3) return null;
  ctx.beginPath();
  shown.forEach((c, i) => (i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])));
  ctx.closePath();
  return shown;
}

/** A soft glow without shadowBlur: two wide faint strokes under the real one. */
function glow(ctx: Ctx, color: string, width: number, draw: () => void) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  for (const [w, a] of [[width * 5, 0.07], [width * 2.4, 0.16], [width, 1]] as const) {
    ctx.lineWidth = w;
    ctx.globalAlpha = a;
    draw();
  }
  ctx.restore();
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string, halo: boolean) {
  if (halo) {
    const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3.2);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** An ellipse on the ground around c with radii along l and u. */
function groundEllipse(ctx: Ctx, view: View, c: Pt, rl: number, ru: number) {
  const p = view.project(c[0], c[1]);
  const a = view.project(c[0] + rl, c[1]);
  const b = view.project(c[0], c[1] + ru);
  if (!p || !a || !b) return false;
  ctx.beginPath();
  ctx.ellipse(p[0], p[1], Math.max(1, Math.hypot(a[0] - p[0], a[1] - p[1])), Math.max(1, Math.hypot(b[0] - p[0], b[1] - p[1])), Math.atan2(a[1] - p[1], a[0] - p[0]), 0, Math.PI * 2);
  return true;
}

/** Draw one frame of a scene as a camera sees it. */
export function drawFrame(ctx: Ctx, scene: Scene, view: View, frame: number, vp: Viewport, theme: Theme, o: Overlays) {
  const left = scene.play.dir === "left";
  const uOf = (x: number) => (left ? scene.play.yl - x : x - scene.play.yl);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, vp.w, vp.h);

  // the ground around the field, as far as a perspective camera sees, so the end lines are not the edge of the world
  if (!view.flat && fillGround(ctx, view, [[-30, view.uMin], [FIELD_W + 30, view.uMin], [FIELD_W + 30, view.uMax], [-30, view.uMax]])) {
    ctx.fillStyle = theme.apron;
    ctx.fill();
  }
  // turf, between the end lines, as far as the camera sees
  const fu0 = Math.min(uOf(0), uOf(120));
  const fu1 = Math.max(uOf(0), uOf(120));
  const u0 = Math.max(view.uMin, fu0);
  const u1 = Math.min(view.uMax, fu1);
  const turf = u1 > u0 ? fillGround(ctx, view, [[0, u0], [FIELD_W, u0], [FIELD_W, u1], [0, u1]]) : null;
  if (turf) {
    const ys = turf.map((c) => c[1]);
    const top = Math.max(-vp.h, Math.min(...ys));
    const g = ctx.createLinearGradient(0, top, 0, Math.min(2 * vp.h, Math.max(top + 1, ...ys)));
    g.addColorStop(0, view.flat ? theme.turfNear : theme.turfFar);
    g.addColorStop(1, theme.turfNear);
    ctx.fillStyle = g;
    ctx.fill();
    // end zones
    for (const [a, b] of [[0, 10], [110, 120]]) {
      const ea = Math.max(u0, Math.min(uOf(a), uOf(b)));
      const eb = Math.min(u1, Math.max(uOf(a), uOf(b)));
      if (eb > ea && fillGround(ctx, view, [[0, ea], [FIELD_W, ea], [FIELD_W, eb], [0, eb]])) {
        ctx.fillStyle = theme.endZone;
        ctx.fill();
      }
    }
  }

  // yard lines every five yards, hash marks every yard, numbers every ten, all on the real field
  ctx.lineWidth = 1;
  for (let x = 0; x <= 120; x++) {
    const u = uOf(x);
    if (u < u0 || u > u1) continue;
    if (x % 5 === 0 && x >= 10 && x <= 110) {
      const goal = x === 10 || x === 110;
      ctx.strokeStyle = `rgba(${theme.line},${goal ? 0.5 : x % 10 === 0 ? 0.26 : 0.14})`;
      ctx.lineWidth = goal ? 2 : 1;
      line(ctx, view, [0, u], [FIELD_W, u]);
      ctx.lineWidth = 1;
    } else if (x > 10 && x < 110) {
      ctx.strokeStyle = `rgba(${theme.line},.18)`;
      for (const l of [0.6, HASH, FIELD_W - HASH, FIELD_W - 0.6]) line(ctx, view, [l - 0.35, u], [l + 0.35, u]);
    }
    if (x % 10 === 0 && x > 10 && x < 110) {
      const n = String(x <= 60 ? x - 10 : 110 - x);
      for (const l of [9, FIELD_W - 9]) {
        const p = view.project(l, u);
        if (!p) continue;
        ctx.fillStyle = theme.number;
        ctx.font = `600 ${Math.max(9, Math.min(34, p[2] * 2.2))}px ${theme.display}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n, p[0], p[1]);
      }
    }
  }
  ctx.strokeStyle = `rgba(${theme.line},.4)`;
  line(ctx, view, [0, u0], [0, u1]);
  line(ctx, view, [FIELD_W, u0], [FIELD_W, u1]);

  // the fog toward the horizon
  if (!view.flat) {
    const g = ctx.createLinearGradient(0, 0, 0, vp.h * 0.4);
    g.addColorStop(0, theme.bg);
    g.addColorStop(1, "rgba(5,7,10,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vp.w, vp.h * 0.4);
  }

  // line of scrimmage and first down
  glow(ctx, theme.los, 2.4, () => line(ctx, view, [0, 0], [FIELD_W, 0]));
  const goalU = left ? uOf(10) : uOf(110);
  if (scene.dist < goalU) glow(ctx, theme.firstDown, 1.8, () => line(ctx, view, [0, scene.dist], [FIELD_W, scene.dist]));

  // the landing ring
  const thrown = frame >= scene.nIn - 1;
  const land = o.land ?? scene.land;
  if (thrown || o.editing) {
    ctx.save();
    ctx.strokeStyle = theme.land;
    ctx.globalAlpha = o.editing ? 1 : 0.4 + 0.5 * airAt(scene, frame);
    ctx.lineWidth = o.editing ? 2.5 : 2;
    if (groundEllipse(ctx, view, land, 1.3, 1.3)) ctx.stroke();
    if (o.editing && groundEllipse(ctx, view, land, 2.6, 2.6)) {
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // the model's expected path for the featured defender, drawn as the ball flies
  const f = scene.featured;
  if (f && f.ghost && thrown) {
    const k = frame - (scene.nIn - 1);
    const pts = f.ghost.slice(0, Math.floor(k) + 1).concat([ghostAt(f, scene, frame)!]);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = theme.ghost;
    ctx.lineWidth = 2;
    path(ctx, view, pts);
    ctx.setLineDash([3, 3]);
    const g = ghostAt(f, scene, frame)!;
    const p = view.project(g[0], g[1]);
    if (p) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], Math.max(4, p[2] * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // what if paths, whole, as the live model drew them
  if (o.whatIf)
    for (const [id, pts] of o.whatIf) {
      const a = scene.actors.find((x) => x.id === id);
      if (!a) continue;
      const from = a.path[scene.nIn - 1];
      glow(ctx, theme.whatIf, 2, () => path(ctx, view, [from, ...pts]));
    }

  // trails for the flagged players
  for (const a of scene.actors.filter((x) => x.flagged)) {
    const pts = a.path.slice(o.start, Math.floor(frame) + 1).concat([along(a.path, frame)]);
    const featured = a === f;
    const color = featured ? theme.featured : a.offense ? theme.target : theme.defense;
    if (featured || a.role === "target") glow(ctx, color, 3, () => path(ctx, view, pts));
    else {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      path(ctx, view, pts);
      ctx.restore();
    }
  }

  // players, far ones first
  const placed = scene.actors
    .map((a) => ({ a, p: along(a.path, frame) }))
    .map(({ a, p }) => ({ a, q: view.project(p[0], p[1]) }))
    .filter((x) => x.q)
    .sort((x, y) => x.q![2] - y.q![2]);
  for (const { a, q } of placed) {
    const [x, y, s] = q!;
    const featured = a === f;
    dot(ctx, x, y, Math.max(2.5, s * 0.55), featured ? theme.featured : a.offense ? theme.offense : theme.defense, featured || a.role === "target");
  }
  // names: the target's above his dot and the featured defender's below his; when the two dots are near each other
  // on screen, the higher dot's name goes above it and the lower dot's below it, so the names never share a row
  const named = placed.filter(({ a }) => a === f || a.role === "target");
  const near = named.length === 2 && Math.abs(named[0].q![0] - named[1].q![0]) < 90 && Math.abs(named[0].q![1] - named[1].q![1]) < 70;
  const higher = near ? (named[0].q![1] <= named[1].q![1] ? named[0].a : named[1].a) : null;
  for (const { a, q } of named) {
    const [x, y, s] = q!;
    const r = Math.max(2.5, s * 0.55);
    const featured = a === f;
    const above = higher ? a === higher : !featured;
    ctx.fillStyle = featured ? theme.featured : theme.target;
    ctx.font = `700 ${Math.max(10, Math.min(16, s * 1.3))}px ${theme.display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(surname(a.name), x, above ? y - r - 9 : y + r + 10);
  }

  // the ball and its shadow
  if (thrown && frame < scene.frames - 1) {
    const [l, u, z] = ballAt(scene, frame, land);
    const shadow = view.project(l, u);
    const ball = view.project(l, u, z);
    if (shadow) {
      ctx.fillStyle = "rgba(0,0,0,.4)";
      ctx.beginPath();
      ctx.ellipse(shadow[0], shadow[1], Math.max(2, shadow[2] * 0.45), Math.max(1, shadow[2] * 0.2), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (ball) dot(ctx, ball[0], ball[1], Math.max(2.5, ball[2] * 0.3), theme.ball, true);
  }

  // at arrival: the model's spread around where it expected him, and the gap to where he was
  if (f && f.ghost && f.spread && o.arrive > 0) {
    const ge = f.ghost[f.ghost.length - 1];
    const ae = f.path[scene.frames - 1];
    ctx.save();
    ctx.globalAlpha = o.arrive;
    ctx.fillStyle = "rgba(255,255,255,.07)";
    ctx.strokeStyle = "rgba(255,255,255,.4)";
    ctx.setLineDash([4, 4]);
    if (groundEllipse(ctx, view, ge, f.spread[0], f.spread[1])) {
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    glow(ctx, theme.featured, 2, () => {
      ctx.globalAlpha *= o.arrive;
      line(ctx, view, ge, ae);
    });
  }
}
