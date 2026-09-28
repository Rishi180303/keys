import type { Play, Rating } from "../lib/types";

/** Field width in yards, sideline to sideline. */
export const FIELD_W = 53.3;
/** Yards across (l, left to right as seen from behind the offense) and downfield from the line of scrimmage (u). */
export type Pt = [number, number];

export type Actor = {
  id: number;
  name: string;
  pos: string;
  offense: boolean;
  role: "passer" | "target" | "route" | "coverage";
  /** predicted by the model: the targeted receiver and the flagged defenders */
  flagged: boolean;
  /** one point per scene frame: the input frames padded at the front, then the output frames */
  path: Pt[];
  /** for flagged players, the throw spot then one expected point per air frame */
  ghost: Pt[] | null;
  /** for flagged players, the model's spread at arrival in yards, across and downfield */
  spread: Pt | null;
};

export type Scene = {
  /** input frames; the throw is frame nIn - 1 */
  nIn: number;
  /** air frames; arrival is frame nIn + nfo - 1 */
  nfo: number;
  frames: number;
  actors: Actor[];
  passer: Actor;
  target: Actor | null;
  /** the flagged defenders */
  defenders: Actor[];
  featured: Actor | null;
  rating: Rating | null;
  land: Pt;
  throwSpot: Pt;
  /** yards to go, so the first down line sits at u = dist */
  dist: number;
  play: Play;
  /** field coordinates to scene coordinates and back */
  toScene: (x: number, y: number) => Pt;
  toField: (p: Pt) => [number, number];
};

const ROLES: Record<string, Actor["role"]> = {
  Passer: "passer",
  "Targeted Receiver": "target",
  "Other Route Runner": "route",
  "Defensive Coverage": "coverage",
};

/** One play from a game file as a scene. The featured defender is featuredId when given, else the primary rated
 * defender, else the first flagged defender. */
export function buildScene(play: Play, featuredId?: number): Scene {
  const left = play.dir === "left";
  const toScene = (x: number, y: number): Pt => (left ? [y, play.yl - x] : [FIELD_W - y, x - play.yl]);
  const toField = ([l, u]: Pt): [number, number] => (left ? [play.yl - u, l] : [play.yl + u, FIELD_W - l]);
  const nIn = Math.max(...play.players.map((p) => p.in.length));
  const nfo = play.nfo;
  const actors: Actor[] = play.players.map((p) => {
    const pad = nIn - p.in.length;
    const input = Array.from({ length: nIn }, (_, i) => toScene(p.in[Math.max(0, i - pad)][0], p.in[Math.max(0, i - pad)][1]));
    const last = input[nIn - 1];
    const out = p.out ?? [];
    const air = Array.from({ length: nfo }, (_, k) => (out.length ? toScene(...(out[Math.min(k, out.length - 1)] as [number, number])) : last));
    const pred = p.pred && p.pred.length ? p.pred : null;
    const ghost = pred ? [last, ...Array.from({ length: nfo }, (_, k) => toScene(pred[Math.min(k, pred.length - 1)][0], pred[Math.min(k, pred.length - 1)][1]))] : null;
    const end = pred ? pred[Math.min(nfo, pred.length) - 1] : null;
    return {
      id: p.id,
      name: p.name,
      pos: p.pos,
      offense: p.side === "Offense",
      role: ROLES[p.role] ?? "coverage",
      flagged: p.p,
      path: [...input, ...air],
      ghost,
      // sd_x runs along the field (downfield), sd_y across it
      spread: end ? [end[3], end[2]] : null,
    };
  });
  // a few plays have no player tagged Passer: take the offensive player deepest behind the line at the throw
  const deepest = (list: Actor[]) => list.reduce((a, b) => (b.path[nIn - 1][1] < a.path[nIn - 1][1] ? b : a));
  const offense = actors.filter((a) => a.offense && a.role !== "target");
  const passer = actors.find((a) => a.role === "passer") ?? (offense.length ? deepest(offense) : actors[0]);
  const defenders = actors.filter((a) => !a.offense && a.flagged);
  const primary = play.ratings.find((r) => r.role === "primary");
  const featuredWanted = featuredId ?? primary?.id;
  const featured = actors.find((a) => a.id === featuredWanted && !a.offense) ?? defenders[0] ?? null;
  return {
    nIn,
    nfo,
    frames: nIn + nfo,
    actors,
    passer,
    target: actors.find((a) => a.role === "target") ?? null,
    defenders,
    featured,
    rating: featured ? play.ratings.find((r) => r.id === featured.id) ?? null : null,
    land: toScene(play.land[0], play.land[1]),
    throwSpot: passer.path[nIn - 1],
    dist: play.dist,
    play,
    toScene,
    toField,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** A point along a per frame path at a fractional frame, clamped to the path's ends. */
export function along(path: Pt[], frame: number): Pt {
  const i = Math.min(path.length - 1, Math.max(0, Math.floor(frame)));
  const j = Math.min(path.length - 1, i + 1);
  const t = clamp01(frame - i);
  return [lerp(path[i][0], path[j][0], t), lerp(path[i][1], path[j][1], t)];
}

/** How far through the air the ball is at a frame, 0 at the throw and 1 at arrival. */
export const airAt = (scene: Scene, frame: number) => clamp01((frame - (scene.nIn - 1)) / scene.nfo);

/** Where an actor's expected (ghost) point is at a frame; the throw spot before the throw. */
export function ghostAt(actor: Actor, scene: Scene, frame: number): Pt | null {
  return actor.ghost ? along(actor.ghost, Math.max(0, frame - (scene.nIn - 1))) : null;
}

/** The drawn ball, [across, downfield, height]: with the passer before the throw, then on a straight line to the
 * landing spot (or a what if spot) with a height of 1.6 yards at release falling to 0 plus an arc of 4 h s (1 - s),
 * h = min(9, 0.22 x throw distance). The data tracks players, not the ball. */
export function ballAt(scene: Scene, frame: number, land: Pt = scene.land): [number, number, number] {
  if (frame < scene.nIn - 1) {
    const [l, u] = along(scene.passer.path, frame);
    return [l, u, 1.6];
  }
  const s = airAt(scene, frame);
  const [a, b] = [scene.throwSpot, land];
  const h = Math.min(9, 0.22 * Math.hypot(b[0] - a[0], b[1] - a[1]));
  return [lerp(a[0], b[0], s), lerp(a[1], b[1], s), 1.6 * (1 - s) + 4 * h * s * (1 - s)];
}
