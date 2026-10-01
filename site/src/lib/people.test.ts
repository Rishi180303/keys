import { describe, expect, it } from "vitest";
import { board, listed, mainTeam, search } from "./people";
import type { PlayerRating } from "./rating";
import type { Meta, PlayRow } from "./types";

// different k per group, so a rating that took another group's shrinkage would change the order
const meta = { min_plays: 2, shrink: { CB: { within: 1, between: 1, k: 1 }, S: { within: 1, between: 1, k: 3 } } } as unknown as Meta;

function row(id: number, name: string, grp: string, zc: number, over: Partial<PlayRow> = {}): PlayRow {
  return {
    game: 1, play: id * 10 + Math.round(zc * 100), week: 1, id, name, pos: grp, grp, team: "KC", cov: "c", mz: "zone", route: "GO",
    result: "C", epa: 0, air: 20, role: "primary", d0: 5, dexp: 3, dact: 1, yards: 1, z: zc, zc, ex: null, ...over,
  };
}

const rows = [
  row(1, "Jalen Ramsey", "CB", 1), row(1, "Jalen Ramsey", "CB", 0.5),
  row(2, "Kei'Trel Clark", "CB", 0.2), row(2, "Kei'Trel Clark", "CB", 0.1),
  row(3, "José Ramírez", "S", 0.9), row(3, "José Ramírez", "S", 0.8),
  row(4, "Ramsey Walker", "S", 2), // one rated play: not listed
  row(5, "Ray Lewis", "S", 3, { ex: "out of bounds" }), row(5, "Ray Lewis", "S", 3),
];

describe("listed and board", () => {
  it("lists every defender with enough rated plays, each with his own group's shrinkage", () => {
    // Ramsey 0.75 * 2 / 3 = 0.5, Ramírez 0.85 * 2 / 5 = 0.34, Clark 0.15 * 2 / 3 = 0.1
    expect(listed(rows, meta).map((p) => p.id)).toEqual([1, 3, 2]);
    expect(board(rows, meta, "CB").map((p) => p.id)).toEqual([1, 2]);
    expect(board(rows, meta, "S").map((p) => p.id)).toEqual([3]);
  });
});

describe("search", () => {
  const players = listed(rows, meta);
  const names = (q: string) => search(players, q).map((p) => p.name);
  it("finds names from the start first, then from a later word, then anywhere", () => {
    expect(names("ram")).toEqual(["Jalen Ramsey", "José Ramírez"]);
    expect(names("jal")).toEqual(["Jalen Ramsey"]);
    // in leaderboard order the start match is last, so only the ranking puts it first
    const ps = ["Desmond King", "Ann Smith", "Smith Jones"].map((name) => ({ name })) as unknown as PlayerRating[];
    expect(search(ps, "sm").map((p) => p.name)).toEqual(["Smith Jones", "Ann Smith", "Desmond King"]);
  });
  it("ignores case, accents, punctuation and spaces", () => {
    expect(names("JOSE RAMIREZ")).toEqual(["José Ramírez"]);
    expect(names("keitrel")).toEqual(["Kei'Trel Clark"]);
    expect(names("kei trel")).toEqual(["Kei'Trel Clark"]);
  });
  it("finds nothing for an empty box or a name nobody has", () => {
    expect([names(""), names("   "), names("zz")]).toEqual([[], [], []]);
  });
  it("stops at the limit", () => {
    expect(search(players, "a", 2)).toHaveLength(2);
  });
});

describe("mainTeam", () => {
  it("is the team with the most rated plays, else the team of his latest game", () => {
    const p = { teams: [{ team: "NE", n: 20 }, { team: "KC", n: 12 }], plays: [] } as unknown as PlayerRating;
    expect(mainTeam(p)).toBe("NE");
    // plays come best first, so the latest game is not the last element
    const moved = { teams: [], plays: [{ team: "MIA", game: 2023121700 }, { team: "NE", game: 2023111200 }] };
    expect(mainTeam(moved as unknown as PlayerRating)).toBe("MIA");
    expect(mainTeam({ teams: [], plays: [] } as unknown as PlayerRating)).toBe("");
  });
});
