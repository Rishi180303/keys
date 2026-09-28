import type { GamePlayer, Play } from "../lib/types";

/** A made up but realistic play for tests, since the tracking data never goes in the repo. depth and across place
 * the landing spot in scene terms: yards downfield of the line of scrimmage and yards across from the left
 * sideline as seen from behind the offense. inFrames is the longest input (20 by default; more than 22 exercises the
 * lead in cutoff), helpShort leaves the safety (id 4) twenty yards short of the ball, and primary picks which
 * flagged defender is the primary one (3, the corner, by default). */
export type Shape = { dir: "left" | "right"; yl: number; depth: number; across: number; nfo?: number; inFrames?: number; helpShort?: boolean; primary?: 3 | 4 };

const W = 53.3;

export function makePlay(s: Shape): Play {
  const toField = (l: number, u: number): [number, number] => (s.dir === "left" ? [s.yl - u, l] : [s.yl + u, W - l]);
  const nfo = s.nfo ?? Math.round(5 + s.depth / 2.2);
  const IN = s.inFrames ?? 20;
  const SHORT = Math.max(5, IN - 5);
  const line = (a: [number, number], b: [number, number], n: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = n === 1 ? 1 : i / (n - 1);
      return toField(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    });
  const frames = (pts: [number, number][]) => pts.map(([x, y]) => [x, y, 5, 1, 90, 90]);
  const land: [number, number] = [s.across, s.depth];
  const toward = (from: [number, number], by: number): [number, number] => {
    const d = Math.hypot(land[0] - from[0], land[1] - from[1]) || 1;
    return [land[0] + ((from[0] - land[0]) / d) * by, land[1] + ((from[1] - land[1]) / d) * by];
  };
  const player = (id: number, over: Partial<GamePlayer>): GamePlayer => ({
    id, name: `Player ${id}`, pos: "CB", side: "Defense", role: "Defensive Coverage", h: "6-0", w: 200, b: "2000-01-01", p: false, in: [], ...over,
  });
  const tStart: [number, number] = [s.across < W / 2 ? s.across + 6 : s.across - 6, 0];
  const tThrow: [number, number] = [tStart[0] + (land[0] - tStart[0]) * 0.6, land[1] * 0.6];
  const d1Start: [number, number] = [Math.min(W, Math.max(0, s.across + 3)), Math.max(4, s.depth * 0.5)];
  const d1Throw: [number, number] = [(d1Start[0] + land[0]) / 2, (d1Start[1] + land[1]) / 2];
  const d2Start: [number, number] = [W / 2, s.depth + 12];
  const d2Throw: [number, number] = [(d2Start[0] + land[0]) / 2, (d2Start[1] + land[1]) / 2 + 4];
  const d2End: [number, number] = s.helpShort ? [Math.min(W, land[0] + 5), land[1] - 20] : toward(d2Throw, 6);
  const d2Pred: [number, number] = s.helpShort ? [Math.min(W, land[0] + 4), land[1] - 17] : toward(d2Throw, 5);
  const primary = s.primary ?? 3;
  return {
    play: 1, desc: "test pass", q: 1, clock: "15:00", down: 2, dist: 7, off: "DET", def: "KC", result: "C",
    cov: "COVER_3_ZONE", mz: "zone", route: "GO", dir: s.dir, yl: s.yl, nfo, land: toField(...land),
    players: [
      player(1, { name: "Pat Passer", pos: "QB", side: "Offense", role: "Passer", in: frames(line([W / 2, -1], [W / 2, -7], IN)) }),
      player(2, {
        name: "Tia Target", pos: "WR", side: "Offense", role: "Targeted Receiver", p: true, in: frames(line(tStart, tThrow, IN)),
        out: line(tThrow, toward(tThrow, 0.3), nfo), pred: line(tThrow, toward(tThrow, 0.5), nfo).map(([x, y]) => [x, y, 0.8, 0.9]),
      }),
      player(3, {
        name: "Cam Corner", p: true, in: frames(line(d1Start, d1Throw, SHORT)),
        out: line(d1Throw, toward(d1Throw, 1), nfo), pred: line(d1Throw, toward(d1Throw, 2.5), nfo).map(([x, y]) => [x, y, 0.9, 1.1]),
      }),
      player(4, {
        name: "Sam Safety", pos: "FS", p: true, in: frames(line(d2Start, d2Throw, SHORT)),
        out: line(d2Throw, d2End, nfo), pred: line(d2Throw, d2Pred, nfo).map(([x, y]) => [x, y, 1, 1]),
      }),
      player(5, { name: "Lee Backer", pos: "MLB", in: frames(line([20, 5], [22, 6], IN)) }),
      player(6, { name: "Rob Route", pos: "WR", side: "Offense", role: "Other Route Runner", in: frames(line([40, 0], [40, 10], IN)) }),
    ],
    ratings: [
      { id: 3, role: primary === 3 ? "primary" : "help", d0: 12, dexp: 2.5, dact: 1, yards: 1.5, z: 1.2, zc: 1.1, ex: null },
      { id: 4, role: primary === 4 ? "primary" : "help", d0: 20, dexp: 5, dact: 6, yards: -1, z: -0.8, zc: -0.7, ex: null },
    ],
  };
}

/** A spread of shapes: both directions, three spots on the field, short to deep, sideline to sideline, with every
 * landing spot inside the field of play; lead ins of 20, 30 and 12 frames, deep help defenders left short of the
 * ball on every other deep shape, and the safety as the primary defender on every fourth. */
export function shapes(): Shape[] {
  const out: Shape[] = [];
  for (const dir of ["left", "right"] as const)
    for (const yl of [20, 50, 95])
      for (const depth of [3, 12, 25, 45])
        for (const across of [1, 14, 27, 40, 52]) {
          const x = dir === "left" ? yl - depth : yl + depth;
          const i = out.length;
          if (x >= 0 && x <= 120)
            out.push({ dir, yl, depth, across, inFrames: [20, 30, 12][i % 3], helpShort: depth >= 25 && i % 2 === 0, primary: i % 4 === 3 ? 4 : 3 });
        }
  return out;
}
