import { applyFilters, rated, ratePlayers, type PlayerRating } from "./rating";
import type { Meta, PlayRow } from "./types";

/** Every listed defender, the way the leaderboard lists him: all his rated plays, his group's shrinkage, best first. */
export function listed(rows: PlayRow[], meta: Meta): PlayerRating[] {
  return ratePlayers(rated(rows), meta.shrink, meta.min_plays);
}

/** The leaderboard of one position group with no filters, best first. */
export function board(rows: PlayRow[], meta: Meta, grp: string): PlayerRating[] {
  const f = { grp, cov: "any", route: "any", role: "any", team: "any", minPlays: meta.min_plays };
  return ratePlayers(applyFilters(rated(rows), f), meta.shrink, meta.min_plays);
}

/** The team a player is shown with: the one he has the most rated plays for, else the team of his latest game.
 * His plays are sorted best first, and game ids grow with the date. */
export const mainTeam = (p: PlayerRating) => p.teams[0]?.team ?? [...p.plays].sort((a, b) => b.game - a.game)[0]?.team ?? "";

const fold = (s: string) => s.normalize("NFKD").replace(/[^a-zA-Z0-9 ]/g, "").toLowerCase();

/** Players whose name matches what was typed, ignoring case, accents and punctuation: a name that starts with it
 * first, then a later word that starts with it, then the rest that contain it, each in leaderboard order. */
export function search(players: PlayerRating[], query: string, limit = 8): PlayerRating[] {
  const q = fold(query).trim();
  if (!q) return [];
  const score = (p: PlayerRating) => {
    const name = fold(p.name);
    if (name.startsWith(q)) return 0;
    if (name.split(" ").some((w) => w.startsWith(q))) return 1;
    return name.includes(q) || name.replace(/ /g, "").includes(q.replace(/ /g, "")) ? 2 : -1;
  };
  return players
    .map((p) => ({ p, s: score(p) }))
    .filter((m) => m.s >= 0)
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((m) => m.p);
}
