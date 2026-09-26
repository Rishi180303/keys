import type { PlayRow, Shrink } from "./types";

/** The leaderboard's filters. cov is any, man, zone or one coverage type. */
export type Filters = { grp: string; cov: string; route: string; role: string; team: string; minPlays: number };
export type Tier = "above" | "average" | "below";
export type PlayerRating = {
  id: number;
  name: string;
  pos: string;
  grp: string;
  n: number;
  mean: number;
  yards: number;
  comp: number;
  epa: number | null;
  teams: { team: string; n: number }[];
  rating: number;
  se: number;
  tier: Tier;
  plays: PlayRow[];
};
export type TeamRating = { team: string; n: number; mean: number; se: number };

/** A team is listed next to a player when he has this many rated plays with it. */
export const TEAM_PLAYS = 10;

export function rated(rows: PlayRow[]): PlayRow[] {
  return rows.filter((r) => r.ex === null);
}

export function applyFilters(rows: PlayRow[], f: Filters): PlayRow[] {
  const cov = (r: PlayRow) =>
    f.cov === "any" || (f.cov === "man" || f.cov === "zone" ? r.mz === f.cov : r.cov === f.cov);
  return rows.filter(
    (r) =>
      r.grp === f.grp &&
      cov(r) &&
      (f.route === "any" || r.route === f.route) &&
      (f.role === "any" || r.role === f.role) &&
      (f.team === "any" || r.team === f.team),
  );
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Sample variance, the same as polars var(). */
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

export function tierOf(rating: number, se: number): Tier {
  return rating > 2 * se ? "above" : rating < -2 * se ? "below" : "average";
}

function groupBy<K>(rows: PlayRow[], key: (r: PlayRow) => K): Map<K, PlayRow[]> {
  const out = new Map<K, PlayRow[]>();
  for (const r of rows) {
    const list = out.get(key(r));
    if (list) list.push(r);
    else out.set(key(r), [r]);
  }
  return out;
}

/** One row per defender with at least minPlays rated plays: the shrunk rating with its standard error and tier,
 * sorted by rating. The same formulas as keys/rate.py players(), on whatever rows the filters left. */
export function ratePlayers(rows: PlayRow[], shrink: Shrink, minPlays: number): PlayerRating[] {
  const out: PlayerRating[] = [];
  for (const [id, plays] of groupBy(rows, (r) => r.id)) {
    const n = plays.length;
    const last = plays[n - 1];
    const s = shrink[last.grp];
    if (n < minPlays || !s) continue;
    const m = mean(plays.map((p) => p.zc));
    const epas = plays.map((p) => p.epa).filter((e): e is number => e !== null);
    const counts = groupBy(plays, (p) => p.team);
    const teams = [...counts]
      .map(([team, list]) => ({ team, n: list.length }))
      .filter((t) => t.n >= TEAM_PLAYS)
      .sort((a, b) => b.n - a.n || a.team.localeCompare(b.team));
    const rating = (m * n) / (n + s.k);
    const se = Math.sqrt(s.within / (n + s.k));
    out.push({
      id,
      name: last.name,
      pos: last.pos,
      grp: last.grp,
      n,
      mean: m,
      yards: mean(plays.map((p) => p.yards)),
      comp: plays.filter((p) => p.result === "C").length / n,
      epa: epas.length ? mean(epas) : null,
      teams,
      rating,
      se,
      tier: tierOf(rating, se),
      plays: [...plays].sort((a, b) => b.zc - a.zc),
    });
  }
  return out.sort((a, b) => b.rating - a.rating || a.id - b.id);
}

/** One row per defensive team: mean and standard error, no shrinkage, the same as keys/rate.py teams(). */
export function rateTeams(rows: PlayRow[]): TeamRating[] {
  const within = variance(rows.map((r) => r.zc));
  return [...groupBy(rows, (r) => r.team)]
    .map(([team, list]) => ({ team, n: list.length, mean: mean(list.map((r) => r.zc)), se: Math.sqrt(within / list.length) }))
    .sort((a, b) => b.mean - a.mean || a.team.localeCompare(b.team));
}
