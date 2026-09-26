import type { Game, Play } from "./types";

export type ApiRow = Record<string, string | number | boolean>;
export type Prediction = {
  model: string;
  predictions: { nfl_id: number; frame_id: number; x: number; y: number; sd_x: number; sd_y: number }[];
};

/** The 23 Kaggle input rows for one play, rebuilt from a game file the way keys/site.py api_rows does it,
 * with the landing spot and the air time replaceable for the what if tool. */
export function apiRows(game: Game, play: Play, land: [number, number] = play.land, nfo: number = play.nfo): ApiRow[] {
  const rows: ApiRow[] = [];
  for (const p of play.players) {
    p.in.forEach(([x, y, s, a, dir, o], i) => {
      rows.push({
        game_id: game.game,
        play_id: play.play,
        player_to_predict: p.p,
        nfl_id: p.id,
        frame_id: i + 1,
        play_direction: play.dir,
        absolute_yardline_number: play.yl,
        player_name: p.name,
        player_height: p.h,
        player_weight: p.w,
        player_birth_date: p.b,
        player_position: p.pos,
        player_side: p.side,
        player_role: p.role,
        x,
        y,
        s,
        a,
        dir,
        o,
        num_frames_output: nfo,
        ball_land_x: land[0],
        ball_land_y: land[1],
      });
    });
  }
  return rows;
}

/** POST one play to the prediction api. A 400 carries the api's own message. */
export async function predict(apiUrl: string, rows: ApiRow[]): Promise<Prediction> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<Prediction> & { error?: string };
  if (!res.ok || !body.predictions) throw new Error(body.error ?? `the api answered ${res.status}`);
  return body as Prediction;
}
