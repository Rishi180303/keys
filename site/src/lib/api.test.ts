import { describe, expect, it } from "vitest";
import { apiRows } from "./api";
import type { Game, Play } from "./types";

const play: Play = {
  play: 7, desc: "pass", q: 1, clock: "15:00", down: 1, dist: 10, off: "DET", def: "KC", result: "C",
  cov: "COVER_3_ZONE", mz: "zone", route: "GO", dir: "right", yl: 50, nfo: 6, land: [60, 20],
  players: [
    { id: 2, name: "Receiver", pos: "WR", side: "Offense", role: "Targeted Receiver", h: "6-0", w: 200, b: "2000-01-01", p: true, in: [[50, 20, 5, 0, 90, 90], [50.5, 20, 5, 0, 90, 90]], out: [[51, 20]], pred: [[51, 20, 0.5, 0.5]] },
    { id: 1, name: "Passer", pos: "QB", side: "Offense", role: "Passer", h: "6-2", w: 220, b: "1995-01-01", p: false, in: [[40, 25, 0, 0, 0, 0], [40, 25, 0, 0, 0, 0]] },
  ],
  ratings: [],
};
const game: Game = { game: 1, week: 1, home: "KC", away: "DET", plays: [play] };

describe("apiRows", () => {
  it("rebuilds the 23 kaggle columns, one row per player and frame", () => {
    const rows = apiRows(game, play);
    expect(rows).toHaveLength(4);
    expect(Object.keys(rows[0])).toHaveLength(23);
    expect(rows[0]).toMatchObject({ game_id: 1, play_id: 7, nfl_id: 2, frame_id: 1, player_to_predict: true, x: 50, y: 20, s: 5, dir: 90, o: 90, num_frames_output: 6, ball_land_x: 60, ball_land_y: 20, play_direction: "right", absolute_yardline_number: 50, player_height: "6-0", player_weight: 200, player_birth_date: "2000-01-01", player_position: "WR", player_side: "Offense", player_role: "Targeted Receiver", player_name: "Receiver" });
    expect(rows[1].frame_id).toBe(2);
    expect(rows[2]).toMatchObject({ nfl_id: 1, frame_id: 1, player_to_predict: false });
  });
  it("replaces the landing spot and the air time for the what if tool", () => {
    const rows = apiRows(game, play, [70, 30.5], 12);
    expect(rows.every((r) => r.ball_land_x === 70 && r.ball_land_y === 30.5 && r.num_frames_output === 12)).toBe(true);
  });
});
