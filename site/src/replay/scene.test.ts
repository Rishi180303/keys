import { describe, expect, it } from "vitest";
import { along, ballAt, buildScene, FIELD_W, ghostAt } from "./scene";
import { makePlay } from "./testplays";

describe("buildScene", () => {
  it("measures downfield from the line of scrimmage and across from the offense's left, in both directions", () => {
    const left = buildScene(makePlay({ dir: "left", yl: 50, depth: 25, across: 14 }));
    const right = buildScene(makePlay({ dir: "right", yl: 50, depth: 25, across: 14 }));
    for (const s of [left, right]) {
      expect(s.land[0]).toBeCloseTo(14);
      expect(s.land[1]).toBeCloseTo(25);
      expect(s.toField(s.toScene(33.3, 20.5))).toEqual([33.3, 20.5].map((v) => expect.closeTo(v)));
    }
    expect(left.toScene(40, 10)).toEqual([10, 10]);
    expect(right.toScene(60, 10)).toEqual([FIELD_W - 10, 10]);
  });
  it("pads short input at the front, then appends the air frames, and holds players with no output", () => {
    const s = buildScene(makePlay({ dir: "right", yl: 50, depth: 25, across: 14 }));
    expect(s.nIn).toBe(20);
    expect(s.frames).toBe(s.nIn + s.nfo);
    const corner = s.actors.find((a) => a.id === 3)!;
    expect(corner.path).toHaveLength(s.frames);
    expect(corner.path[0]).toEqual(corner.path[5]);
    const backer = s.actors.find((a) => a.id === 5)!;
    expect(backer.path[s.frames - 1]).toEqual(backer.path[s.nIn - 1]);
  });
  it("gives flagged players a ghost that starts at their throw spot, and the spread across then downfield", () => {
    const s = buildScene(makePlay({ dir: "right", yl: 50, depth: 25, across: 14 }));
    const corner = s.actors.find((a) => a.id === 3)!;
    expect(corner.ghost).toHaveLength(s.nfo + 1);
    expect(corner.ghost![0]).toEqual(corner.path[s.nIn - 1]);
    expect(corner.spread).toEqual([1.1, 0.9]);
    expect(ghostAt(corner, s, 0)).toEqual(corner.ghost![0]);
    expect(s.actors.find((a) => a.id === 5)!.ghost).toBeNull();
  });
  it("features the primary rated defender unless told otherwise", () => {
    const play = makePlay({ dir: "right", yl: 50, depth: 25, across: 14 });
    expect(buildScene(play).featured!.id).toBe(3);
    expect(buildScene(play).rating!.role).toBe("primary");
    expect(buildScene(play, 4).featured!.id).toBe(4);
    expect(buildScene(play, 2).featured!.id).toBe(3);
    expect(buildScene({ ...play, ratings: [] }).featured!.id).toBe(3);
    // the safety, not the first flagged defender, when he is the primary one
    const safety = buildScene(makePlay({ dir: "right", yl: 50, depth: 25, across: 14, primary: 4 }));
    expect(safety.featured!.id).toBe(4);
    expect(safety.rating!.role).toBe("primary");
  });
  it("finds a passer when no player is tagged as one: the deepest offensive player who is not the target", () => {
    const play = makePlay({ dir: "left", yl: 50, depth: 25, across: 14 });
    const untagged = { ...play, players: play.players.map((p) => (p.role === "Passer" ? { ...p, role: "Other Route Runner" } : p)) };
    expect(buildScene(untagged).passer.id).toBe(1);
  });
  it("draws the ball from the passer at the throw to the landing spot with an arc", () => {
    const s = buildScene(makePlay({ dir: "left", yl: 60, depth: 40, across: 20 }));
    expect(ballAt(s, 0)).toEqual([...along(s.passer.path, 0), 1.6]);
    const [l, u, z] = ballAt(s, s.frames - 1);
    expect([l, u, z]).toEqual([expect.closeTo(20), expect.closeTo(40), expect.closeTo(0)]);
    const mid = ballAt(s, s.nIn - 1 + s.nfo / 2);
    expect(mid[2]).toBeCloseTo(0.8 + Math.min(9, 0.22 * Math.hypot(20 - FIELD_W / 2, 40 + 7)));
    // in a what if the ball flies to the moved spot
    expect(ballAt(s, s.frames - 1, [30, 12])).toEqual([expect.closeTo(30), expect.closeTo(12), expect.closeTo(0)]);
  });
});
