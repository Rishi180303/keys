"""The website's data files: the plays table, one file per game for the viewer, and the meta file."""

import json
import shutil
from pathlib import Path

import polars as pl

from keys import KEY
from keys.rate import MIN_PLAYS

PLAY_COLUMNS = {
    "game_id": "game", "play_id": "play", "week": "week", "nfl_id": "id", "name": "name", "pos": "pos", "grp": "grp",
    "team": "team", "cov": "cov", "mz": "mz", "route": "route", "result": "result", "epa": "epa", "frames": "air",
    "role": "role", "d0": "d0", "dexp": "dexp", "dact": "dact", "yards": "yards", "z": "z", "zc": "zc", "ex": "ex",
}
STATIC = {
    "player_name": "name", "player_position": "pos", "player_side": "side", "player_role": "role",
    "player_height": "h", "player_weight": "w", "player_birth_date": "b", "player_to_predict": "p",
}
FRAME = ["x", "y", "s", "a", "dir", "o"]
PLAY_META = ["desc", "q", "clock", "down", "dist", "off", "result", "cov", "mz", "route", "dir", "yl", "nfo"]
RATING_KEYS = ["id", "role", "d0", "dexp", "dact", "yards", "z", "zc", "ex"]
HIGHLIGHT_AIR = 15  # air frames a highlight needs, a second and a half, so the replay has something to show
HIGHLIGHT_KEYS = ["id", "name", "pos", "team", "zc", "yards", "dexp", "dact"]


def _round(cols):
    return [pl.col(c).round(2) for c in cols]


def plays_table(table: pl.DataFrame) -> pl.DataFrame:
    """The rated table with the site's short column names, floats to two decimals and zc to six.

    The site recomputes every tier from zc, and two decimals moved a player sitting 1.4e-05 from a tier line."""
    floats = [c for c in PLAY_COLUMNS if table.schema[c] == pl.Float64 and c != "zc"]
    return table.select(list(PLAY_COLUMNS)).with_columns(*_round(floats), pl.col("zc").round(6)).rename(PLAY_COLUMNS)


def plays_json(table: pl.DataFrame) -> dict:
    """One row per flagged defender play as {"columns": [...], "rows": [[...], ...]}, a third the size of objects."""
    df = plays_table(table)
    return {"columns": df.columns, "rows": df.rows()}


def games_json(inp: pl.DataFrame, out: pl.DataFrame, pred: pl.DataFrame, table: pl.DataFrame, sup: pl.DataFrame) -> dict[int, dict]:
    """One dict per game: every play's frames for every player, actual and expected paths, context and rating rows.

    Each frame array is grouped once by player; nothing is filtered inside a loop."""
    frames = inp.sort(KEY + ["frame_id"]).with_columns(_round(FRAME)).group_by(KEY, maintain_order=True).agg(
        *[pl.col(c).first().alias(n) for c, n in STATIC.items()], *[pl.col(c) for c in FRAME]
    )
    actual = out.sort(KEY + ["frame_id"]).with_columns(_round(["x", "y"])).group_by(KEY, maintain_order=True).agg(
        pl.col("x").alias("ax"), pl.col("y").alias("ay")
    )
    expected = pred.sort(KEY + ["frame_id"]).with_columns(_round(["x_pred", "y_pred", "sd_x", "sd_y"]))
    expected = expected.group_by(KEY, maintain_order=True).agg(
        pl.col("x_pred").alias("px"), pl.col("y_pred").alias("py"), pl.col("sd_x").alias("psx"), pl.col("sd_y").alias("psy")
    )
    people = frames.join(actual, on=KEY, how="left").join(expected, on=KEY, how="left")
    meta = inp.group_by("game_id", "play_id").agg(
        pl.col("play_direction").first().alias("dir"), pl.col("absolute_yardline_number").first().alias("yl"),
        pl.col("num_frames_output").first().alias("nfo"), pl.col("ball_land_x").first().round(2).alias("lx"),
        pl.col("ball_land_y").first().round(2).alias("ly"),
    ).join(sup, on=["game_id", "play_id"], how="left")
    ratings: dict[tuple, list] = {}
    for row in plays_table(table).select(["game", "play"] + RATING_KEYS).to_dicts():
        ratings.setdefault((row.pop("game"), row.pop("play")), []).append(row)
    by_play: dict[tuple, list] = {}
    for p in people.iter_rows(named=True):
        player = {"id": p["nfl_id"], **{n: p[n] for n in STATIC.values()}, "in": [list(f) for f in zip(*(p[c] for c in FRAME))]}
        if p["ax"] is not None:
            player["out"] = [list(f) for f in zip(p["ax"], p["ay"])]
        if p["px"] is not None:
            player["pred"] = [list(f) for f in zip(p["px"], p["py"], p["psx"], p["psy"])]
        by_play.setdefault((p["game_id"], p["play_id"]), []).append(player)
    games: dict[int, dict] = {}
    for m in meta.sort("game_id", "play_id").iter_rows(named=True):
        key = (m["game_id"], m["play_id"])
        g = games.setdefault(m["game_id"], {"game": m["game_id"], "week": m["week"], "home": m["home"], "away": m["away"], "plays": []})
        play = {"play": m["play_id"], **{k: m[k] for k in PLAY_META}, "def": m["team"], "land": [m["lx"], m["ly"]]}
        play["players"], play["ratings"] = by_play[key], ratings.get(key, [])
        g["plays"].append(play)
    return games


def highlights(table: pl.DataFrame, games: dict[int, dict], n: int = 8) -> list[dict]:
    """The home page reel: the best rated plays with what a replay needs, at most one per listed defender.

    A candidate is a rated play by a defender with MIN_PLAYS rated plays, in the primary role, with at least
    HIGHLIGHT_AIR air frames, where he ended nearer the ball than expected, so the picture agrees with the caption.
    The top two of every position group go in first, the best of the rest fill up to n, and the list is ordered
    by zc; every tie breaks by game, then play. Each entry's scene is the play as the game file holds it, with
    the input frames cut down to x and y."""
    by, desc = ["zc", "game", "play"], [True, False, False]
    rated = plays_table(table).filter(pl.col("ex").is_null())
    best = (
        rated.filter(pl.len().over("id") >= MIN_PLAYS)
        .filter((pl.col("role") == "primary") & (pl.col("air") >= HIGHLIGHT_AIR) & (pl.col("dact") < pl.col("dexp")))
        .sort(by, descending=desc)
        .unique(subset="id", keep="first", maintain_order=True)
    )
    best = best.with_columns(floor=pl.int_range(pl.len()).over("grp") < 2)
    picks = best.sort(["floor", *by], descending=[True, *desc]).head(n).sort(by, descending=desc)
    reel = []
    for r in picks.iter_rows(named=True):
        game = games[r["game"]]
        play = next(p for p in game["plays"] if p["play"] == r["play"])
        scene = {**play, "players": [{**p, "in": [f[:2] for f in p["in"]]} for p in play["players"]]}
        entry = {"game": r["game"], "play": r["play"], "week": game["week"], "home": game["home"], "away": game["away"]}
        reel.append({**entry, **{k: r[k] for k in HIGHLIGHT_KEYS}, "scene": scene})
    return reel


def api_rows(game: dict, play: dict) -> list[dict]:
    """The 23 Kaggle input rows for one play, rebuilt from a game file the way the site does it."""
    rows = []
    for p in play["players"]:
        for i, (x, y, s, a, d, o) in enumerate(p["in"], start=1):
            rows.append({
                "game_id": game["game"], "play_id": play["play"], "player_to_predict": p["p"], "nfl_id": p["id"], "frame_id": i,
                "play_direction": play["dir"], "absolute_yardline_number": play["yl"], "player_name": p["name"],
                "player_height": p["h"], "player_weight": p["w"], "player_birth_date": p["b"], "player_position": p["pos"],
                "player_side": p["side"], "player_role": p["role"], "x": x, "y": y, "s": s, "a": a, "dir": d, "o": o,
                "num_frames_output": play["nfo"], "ball_land_x": play["land"][0], "ball_land_y": play["land"][1],
            })
    return rows


def meta_json(run: str, api_url: str, summary: dict | None, result: dict, generated: str) -> dict:
    """What the site needs to know about the run: names, headline numbers, the gate, and the shrinkage table."""
    table = result["table"]
    return {
        "run": run, "generated": generated, "api_url": api_url, "summary": summary, "gate": result["checks"],
        "shrink": result["shrink"], "min_plays": MIN_PLAYS,
        "counts": {"plays": table.select("game_id", "play_id").n_unique(), "games": table["game_id"].n_unique()},
    }


def _dump(obj) -> str:
    return json.dumps(obj, separators=(",", ":"), allow_nan=False)


def write_site(dest, plays: dict, games: dict[int, dict], meta: dict) -> list[Path]:
    """plays.json, meta.json and games/<game_id>.json under dest, compact, no NaN allowed. Returns the files."""
    dest = Path(dest)
    shutil.rmtree(dest, ignore_errors=True)
    (dest / "games").mkdir(parents=True, exist_ok=True)
    files = [dest / "plays.json", dest / "meta.json"]
    files[0].write_text(_dump(plays))
    files[1].write_text(_dump(meta))
    for gid, g in games.items():
        f = dest / "games" / f"{gid}.json"
        f.write_text(_dump(g))
        files.append(f)
    return files
