import { describe, expect, it } from "vitest";
import { applyFilters, ratePlayers, rateTeams, tierOf, variance, type Filters } from "./rating";
import type { PlayRow } from "./types";

const row = (over: Partial<PlayRow>): PlayRow => ({
  game: 1, play: 1, week: 1, id: 1, name: "A", pos: "CB", grp: "CB", team: "KC", cov: "COVER_3_ZONE", mz: "zone",
  route: "GO", result: "C", epa: 0.1, air: 10, role: "primary", d0: 5, dexp: 4, dact: 3, yards: 0.4, z: 0.5, zc: 0.5,
  ex: null, ...over,
});
const any: Filters = { grp: "CB", cov: "any", route: "any", role: "any", team: "any", minPlays: 30 };

describe("ratePlayers", () => {
  // the same numbers as tests/test_rate.py::test_players_shrinks_tiers_and_lists_teams
  const shrink = { CB: { within: 1, between: 0.02, k: 50 } };
  const rows = [
    ...Array.from({ length: 50 }, (_, i) => row({ id: 1, play: i, result: i < 40 ? "C" : "I" })),
    ...Array.from({ length: 30 }, (_, i) =>
      row({ id: 2, name: "B", play: 100 + i, team: i < 25 ? "DET" : "LV", zc: -0.3, result: "I", epa: null }),
    ),
  ];
  it("shrinks with k, computes se and tiers, lists teams with ten plays", () => {
    const [a, b] = ratePlayers(rows, shrink, 30);
    expect(a.id).toBe(1);
    expect(a.rating).toBeCloseTo(0.25);
    expect(a.se).toBeCloseTo(0.1);
    expect(a.tier).toBe("above");
    expect(a.comp).toBeCloseTo(0.8);
    expect(a.teams).toEqual([{ team: "KC", n: 50 }]);
    expect(a.yards).toBeCloseTo(0.4);
    expect(a.epa).toBeCloseTo(0.1);
    expect(b.rating).toBeCloseTo(-0.1125);
    expect(b.se).toBeCloseTo(Math.sqrt(1 / 80));
    expect(b.tier).toBe("average");
    expect(b.teams).toEqual([{ team: "DET", n: 25 }]);
    expect(b.comp).toBe(0);
    expect(b.epa).toBeNull();
  });
  it("drops players under the minimum and sorts a player's plays by zc", () => {
    expect(ratePlayers(rows, shrink, 40).map((p) => p.id)).toEqual([1]);
    const mixed = [row({ id: 3, play: 1, zc: -1 }), row({ id: 3, play: 2, zc: 2 }), row({ id: 3, play: 3, zc: 0.5 })];
    expect(ratePlayers(mixed, shrink, 1)[0].plays.map((p) => p.zc)).toEqual([2, 0.5, -1]);
  });
  it("skips a group with no shrinkage entry", () => {
    expect(ratePlayers([row({ grp: "LB" })], shrink, 1)).toEqual([]);
  });
});

describe("applyFilters", () => {
  const rows = [
    row({ id: 1, grp: "CB", mz: "man", cov: "COVER_1_MAN", route: "GO", role: "primary", team: "KC" }),
    row({ id: 2, grp: "CB", mz: "zone", cov: "COVER_3_ZONE", route: "OUT", role: "help", team: "DET" }),
    row({ id: 3, grp: "S", mz: "zone", cov: "COVER_2_ZONE", route: "GO", role: "primary", team: "KC" }),
  ];
  const ids = (f: Partial<Filters>) => applyFilters(rows, { ...any, ...f }).map((r) => r.id);
  it("filters by group, man or zone, coverage type, route, role and team", () => {
    expect(ids({})).toEqual([1, 2]);
    expect(ids({ grp: "S" })).toEqual([3]);
    expect(ids({ cov: "man" })).toEqual([1]);
    expect(ids({ cov: "zone" })).toEqual([2]);
    expect(ids({ cov: "COVER_3_ZONE" })).toEqual([2]);
    expect(ids({ route: "GO" })).toEqual([1]);
    expect(ids({ role: "help" })).toEqual([2]);
    expect(ids({ team: "DET" })).toEqual([2]);
  });
});

describe("rateTeams", () => {
  it("means and standard errors with the pooled variance", () => {
    const rows = [1, 3, 1, 3].map((zc, i) => row({ play: i, team: "KC", zc })).concat([-1, -3, -1, -3].map((zc, i) => row({ play: 10 + i, team: "DET", zc })));
    const t = rateTeams(rows);
    expect(t.map((x) => x.team)).toEqual(["KC", "DET"]);
    expect(t[0].mean).toBe(2);
    expect(t[1].mean).toBe(-2);
    expect(t[0].se).toBeCloseTo(Math.sqrt(variance(rows.map((r) => r.zc)) / 4));
  });
});

describe("helpers", () => {
  it("variance is the sample variance", () => {
    expect(variance([1, 3, 1, 3])).toBeCloseTo(4 / 3);
    expect(variance([5])).toBe(0);
  });
  it("tiers need two standard errors", () => {
    expect(tierOf(0.25, 0.1)).toBe("above");
    expect(tierOf(-0.25, 0.1)).toBe("below");
    expect(tierOf(0.19, 0.1)).toBe("average");
  });
});
