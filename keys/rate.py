"""Closing over expected: the per play table, situation centering, player and team ratings, and the gate.

Every function takes and returns polars frames and does no I/O, except load_supplementary."""

import math

import numpy as np
import polars as pl

from keys import KEY
from keys.features import FIELD_X, FIELD_Y

GROUPS = {"CB": "CB", "DB": "CB", "FS": "S", "SS": "S", "S": "S"}  # every other position is LB
CELLS = [["air", "role", "grp"], ["route"]]  # the two centering passes, in order
GATED = ["cov", "mz", "start", "route", "air", "role", "grp"]  # the cell dimensions the gate checks
INFO = ["result", "team"]  # reported next to the gate, never gating it
MIN_PLAYS = 30
GATE = {
    "cell_rows": 100, "cell_share": 0.25, "half_plays": 15, "half_players": 30,
    "reliability": 0.4, "league_mean": 0.02, "excluded_share": 0.15,
}
SUP = {
    "week": "week", "home_team_abbr": "home", "visitor_team_abbr": "away", "possession_team": "off",
    "defensive_team": "team", "play_description": "desc", "quarter": "q", "game_clock": "clock", "down": "down",
    "yards_to_go": "dist", "pass_result": "result", "route_of_targeted_receiver": "route",
    "team_coverage_man_zone": "mz", "team_coverage_type": "cov", "expected_points_added": "epa",
}
PLAY = ["game_id", "play_id"]


def load_supplementary(path) -> pl.DataFrame:
    """The play context table with short column names, one row per play."""
    df = pl.read_csv(path, columns=PLAY + list(SUP), infer_schema_length=20000, null_values=["NA"]).rename(SUP)
    if df.n_unique(subset=PLAY) != df.height:
        raise ValueError("supplementary rows are not unique per play")
    mz = pl.col("mz").replace_strict({"MAN_COVERAGE": "man", "ZONE_COVERAGE": "zone"}, default="unknown")
    return df.with_columns(mz=mz, route=pl.col("route").fill_null("unknown"), cov=pl.col("cov").fill_null("unknown"))


def geometry(df: pl.DataFrame) -> pl.DataFrame:
    """Adds d0, dexp, dact, yards, sdu and z.

    Needs x0, y0 (the throw position), x_pred, y_pred, sd_x, sd_y (expected at arrival), x, y (actual at arrival),
    ball_land_x, ball_land_y. u points from the expected position to the landing spot, or from the throw position
    when the expectation is within a yard of the ball; yards is the actual minus expected position along u."""
    ex, ey = pl.col("ball_land_x") - pl.col("x_pred"), pl.col("ball_land_y") - pl.col("y_pred")
    tx, ty = pl.col("ball_land_x") - pl.col("x0"), pl.col("ball_land_y") - pl.col("y0")
    dexp, d0 = (ex**2 + ey**2).sqrt(), (tx**2 + ty**2).sqrt()
    near = dexp < 1.0
    ux = pl.when(near).then(tx / (d0 + 1e-9)).otherwise(ex / (dexp + 1e-9))
    uy = pl.when(near).then(ty / (d0 + 1e-9)).otherwise(ey / (dexp + 1e-9))
    dact = ((pl.col("x") - pl.col("ball_land_x")) ** 2 + (pl.col("y") - pl.col("ball_land_y")) ** 2).sqrt()
    df = df.with_columns(d0=d0, dexp=dexp, dact=dact, ux=ux, uy=uy)
    df = df.with_columns(
        yards=(pl.col("x") - pl.col("x_pred")) * pl.col("ux") + (pl.col("y") - pl.col("y_pred")) * pl.col("uy"),
        sdu=((pl.col("sd_x") * pl.col("ux")) ** 2 + (pl.col("sd_y") * pl.col("uy")) ** 2).sqrt(),
    )
    return df.with_columns(z=pl.col("yards") / pl.col("sdu")).drop("ux", "uy")


def exclusion() -> pl.Expr:
    """The reason a row does not count, or null. Needs num_frames_output, ball_land_x, ball_land_y, recv_dist."""
    x, y = pl.col("ball_land_x"), pl.col("ball_land_y")
    oob = (x < 0) | (x > FIELD_X) | (y < 0) | (y > FIELD_Y)
    return (
        pl.when(pl.col("num_frames_output") > 40).then(pl.lit("over 40 frames"))
        .when(oob).then(pl.lit("out of bounds"))
        .when(pl.col("recv_dist") > 4).then(pl.lit("not catchable"))
        .otherwise(pl.lit(None, dtype=pl.String))
        .alias("ex")
    )


def _arrival(frames: pl.DataFrame, nfo: pl.DataFrame, cols: list[str]) -> pl.DataFrame:
    """The row at the arrival frame for every player in nfo."""
    return frames.join(nfo, on=KEY).filter(pl.col("frame_id") == pl.col("num_frames_output")).select(KEY + cols)


def play_table(inp: pl.DataFrame, out: pl.DataFrame, pred: pl.DataFrame, sup: pl.DataFrame) -> pl.DataFrame:
    """One row per flagged defender play: geometry, situation, context and the exclusion reason.

    Raises when a flagged player has no arrival row, a play does not have one targeted receiver,
    or a play has no supplementary row."""
    last = inp.filter(pl.col("player_to_predict")).sort(KEY + ["frame_id"]).group_by(KEY).agg(
        pl.col("player_role", "player_position", "player_name", "num_frames_output", "ball_land_x", "ball_land_y").last(),
        pl.col("x").last().alias("x0"), pl.col("y").last().alias("y0"),
    )
    nfo = last.select(KEY + ["num_frames_output"])
    actual = _arrival(out, nfo, ["x", "y"])
    expected = _arrival(pred, nfo, ["x_pred", "y_pred", "sd_x", "sd_y", "fold"])
    df = last.join(actual, on=KEY, how="left").join(expected, on=KEY, how="left")
    missing = df.filter(pl.col("x").is_null() | pl.col("x_pred").is_null())
    if missing.height:
        raise ValueError(f"{missing.height} flagged players have no arrival row, first {missing.select(KEY).row(0)}")
    recv = df.filter(pl.col("player_role") == "Targeted Receiver").with_columns(
        recv_dist=((pl.col("x") - pl.col("ball_land_x")) ** 2 + (pl.col("y") - pl.col("ball_land_y")) ** 2).sqrt()
    )
    counts = df.select(PLAY).unique().join(recv.group_by(PLAY).len(), on=PLAY, how="left")
    bad = counts.filter(pl.col("len").fill_null(0) != 1)
    if bad.height:
        raise ValueError(f"{bad.height} plays do not have exactly one targeted receiver, first {bad.row(0)}")
    d = df.filter(pl.col("player_role") == "Defensive Coverage").join(recv.select(PLAY + ["recv_dist"]), on=PLAY)
    d = geometry(d).with_columns(exclusion())
    d = d.join(sup.select(PLAY + ["week", "team", "cov", "mz", "route", "result", "epa"]), on=PLAY, how="left")
    missing = d.filter(pl.col("team").is_null())
    if missing.height:
        raise ValueError(f"{missing.height} defender plays have no supplementary row, first {missing.select(PLAY).row(0)}")
    nfo, d0 = pl.col("num_frames_output"), pl.col("d0")
    rank = pl.col("dexp").rank(method="min").over(PLAY)
    d = d.with_columns(
        role=pl.when(rank == 1).then(pl.lit("primary")).otherwise(pl.lit("help")),
        air=(
            pl.when(nfo <= 8).then(pl.lit("5-8"))
            .when(nfo <= 12).then(pl.lit("9-12"))
            .when(nfo <= 16).then(pl.lit("13-16"))
            .otherwise(pl.lit("17-40"))
        ),
        start=(
            pl.when(d0 < 5).then(pl.lit("0-5"))
            .when(d0 < 10).then(pl.lit("5-10"))
            .when(d0 < 20).then(pl.lit("10-20"))
            .otherwise(pl.lit("20+"))
        ),
        grp=pl.col("player_position").replace_strict(GROUPS, default="LB"),
    )
    keep = KEY + [
        "week", "player_name", "player_position", "grp", "team", "cov", "mz", "route", "result", "epa", "num_frames_output",
        "air", "role", "start", "d0", "dexp", "dact", "yards", "sdu", "z", "ex", "fold",
    ]
    return d.select(keep).rename({"player_name": "name", "player_position": "pos", "num_frames_output": "frames"}).sort(KEY)


def _center_pass(df: pl.DataFrame, cells: list[str]) -> pl.DataFrame:
    """Subtract from zc the mean of the rated rows in the same cell and the other folds.

    When the row's fold is the only one with rated rows in the cell, the mean over all of them is used.
    Excluded rows are centered too but never contribute to a mean."""
    rated = df.filter(pl.col("ex").is_null())
    tot = rated.group_by(cells).agg(pl.col("zc").sum().alias("_ts"), pl.len().alias("_tn"))
    byf = rated.group_by(cells + ["fold"]).agg(pl.col("zc").sum().alias("_fs"), pl.len().alias("_fn"))
    df = df.join(tot, on=cells, how="left").join(byf, on=cells + ["fold"], how="left")
    df = df.with_columns(pl.col("_fs").fill_null(0.0), pl.col("_fn").fill_null(0))
    other = pl.col("_tn") - pl.col("_fn")
    mean = pl.when(other > 0).then((pl.col("_ts") - pl.col("_fs")) / other).otherwise(pl.col("_ts") / pl.col("_tn"))
    return df.with_columns((pl.col("zc") - mean.fill_null(0.0)).alias("zc")).drop("_ts", "_tn", "_fs", "_fn")


def center(table: pl.DataFrame) -> pl.DataFrame:
    """Adds zc: z centered within air bucket by role by position group, then within route, both cross fitted."""
    df = table.with_columns(zc=pl.col("z"))
    for cells in CELLS:
        df = _center_pass(df, cells)
    return df


def shrinkage(table: pl.DataFrame) -> dict[str, dict[str, float]]:
    """Per position group: the variance within players, the variance between player means, and k = within / between."""
    rated = table.filter(pl.col("ex").is_null())
    if not rated.height:
        raise ValueError("no rated rows: every flagged defender play is excluded")
    means = rated.group_by("nfl_id", "grp").agg(pl.len().alias("n"), pl.col("zc").mean().alias("mean"))
    means = means.filter(pl.col("n") >= MIN_PLAYS)
    out = {}
    for grp in sorted(rated["grp"].unique().to_list()):
        within = float(rated.filter(pl.col("grp") == grp)["zc"].var() or 0.0)
        m = means.filter(pl.col("grp") == grp)
        between = float(m["mean"].var() - within / m["n"].mean()) if m.height >= 2 else 0.0
        between = max(between, 1e-6)
        out[grp] = {"within": within, "between": between, "k": within / between}
    return out


def players(table: pl.DataFrame, shrink: dict) -> pl.DataFrame:
    """One row per defender: n, means, the shrunk rating with its standard error and tier, and his teams."""
    rated = table.filter(pl.col("ex").is_null())
    by_team = (
        rated.group_by("nfl_id", "team").len().filter(pl.col("len") >= 10)
        .sort("nfl_id", "len", descending=[False, True])
        .group_by("nfl_id", maintain_order=True).agg(pl.col("team").alias("teams"), pl.col("len").alias("team_n"))
    )
    p = rated.group_by("nfl_id").agg(
        pl.len().alias("n"), pl.col("name").last(), pl.col("pos").last(), pl.col("grp").last(),
        pl.col("zc").mean().alias("mean"), pl.col("yards").mean().alias("yards"),
        (pl.col("result") == "C").mean().alias("comp"), pl.col("epa").mean().alias("epa"),
    ).join(by_team, on="nfl_id", how="left")
    k = pl.col("grp").replace_strict({g: v["k"] for g, v in shrink.items()}, return_dtype=pl.Float64)
    within = pl.col("grp").replace_strict({g: v["within"] for g, v in shrink.items()}, return_dtype=pl.Float64)
    p = p.with_columns(rating=pl.col("mean") * pl.col("n") / (pl.col("n") + k), se=(within / (pl.col("n") + k)).sqrt())
    tier = (
        pl.when(pl.col("rating") > 2 * pl.col("se")).then(pl.lit("above"))
        .when(pl.col("rating") < -2 * pl.col("se")).then(pl.lit("below"))
        .otherwise(pl.lit("average"))
    )
    return p.with_columns(tier=tier, listed=pl.col("n") >= MIN_PLAYS).sort("rating", "nfl_id", descending=[True, False])


def teams(table: pl.DataFrame) -> pl.DataFrame:
    """One row per defensive team: n, mean and standard error, no shrinkage."""
    rated = table.filter(pl.col("ex").is_null())
    within = float(rated["zc"].var() or 0.0)
    t = rated.group_by("team").agg(pl.len().alias("n"), pl.col("zc").mean().alias("mean"))
    return t.with_columns(se=(within / pl.col("n")).sqrt()).sort("mean", "team", descending=[True, False])


def split_half(rated: pl.DataFrame) -> tuple[float | None, int]:
    """Correlation of player means between even and odd game ids, over players with enough plays in both halves."""
    h = rated.with_columns(half=pl.col("game_id") % 2).group_by("nfl_id", "half").agg(pl.len().alias("n"), pl.col("zc").mean())
    h = h.pivot(on="half", index="nfl_id", values=["zc", "n"])
    if not {"zc_0", "zc_1", "n_0", "n_1"} <= set(h.columns):
        return None, 0
    h = h.filter((pl.col("n_0") >= GATE["half_plays"]) & (pl.col("n_1") >= GATE["half_plays"]))
    if h.height < 2:
        return None, h.height
    r = float(np.corrcoef(h["zc_0"], h["zc_1"])[0, 1])
    return (r if math.isfinite(r) else None), h.height


def _cells(rated: pl.DataFrame, dim: str) -> list[dict]:
    t = rated.group_by(dim).agg(pl.len().alias("n"), pl.col("zc").mean().alias("mean"))
    t = t.filter(pl.col("n") >= GATE["cell_rows"]).sort(dim)
    return [{"dim": dim, "cell": str(r[dim]), "n": r["n"], "mean": r["mean"]} for r in t.iter_rows(named=True)]


def gate(table: pl.DataFrame, players_df: pl.DataFrame) -> dict:
    """Every check with its numbers, and passed. Values are plain python so the dict can be written as json."""
    rated = table.filter(pl.col("ex").is_null())
    listed = players_df.filter(pl.col("listed"))
    player_sd = float(listed["mean"].std()) if listed.height >= 2 else None
    limit = GATE["cell_share"] * player_sd if player_sd is not None else None
    cells, failed = [], []
    for dim in GATED:
        for c in _cells(rated, dim):
            c["ok"] = limit is not None and abs(c["mean"]) <= limit
            cells.append(c)
            if not c["ok"]:
                failed.append(f"{dim}={c['cell']} mean {c['mean']:+.3f}")
    r, n_half = split_half(rated)
    rel_ok = r is not None and n_half >= GATE["half_players"] and r >= GATE["reliability"]
    if not rel_ok:
        failed.append(f"reliability {r} over {n_half} players")
    league = float(rated["zc"].mean()) if rated.height else None
    league_ok = league is not None and abs(league) <= GATE["league_mean"]
    if not league_ok:
        failed.append(f"league mean {league}")
    by_reason = {k: v for k, v in table["ex"].drop_nulls().value_counts().rows()}
    share = (table.height - rated.height) / table.height if table.height else 1.0
    ex_ok = share <= GATE["excluded_share"]
    if not ex_ok:
        failed.append(f"excluded share {share:.3f}")
    return {
        "passed": not failed, "failed": failed, "limit": limit, "player_sd": player_sd, "cells": cells,
        "info": {dim: _cells(rated, dim) for dim in INFO},
        "reliability": {"r": r, "players": n_half, "ok": rel_ok},
        "league_mean": {"value": league, "ok": league_ok},
        "excluded": {"rows": table.height - rated.height, "share": share, "by_reason": by_reason, "ok": ex_ok},
        "rows": {"flagged": table.height, "rated": rated.height, "players_listed": listed.height},
        "rules": {**GATE},
    }


def compute(inp: pl.DataFrame, out: pl.DataFrame, pred: pl.DataFrame, sup: pl.DataFrame) -> dict:
    """The whole rating: the centered play table, the player and team tables, the shrinkage table and the gate."""
    table = center(play_table(inp, out, pred, sup))
    shrink = shrinkage(table)
    players_df = players(table, shrink)
    return {"table": table, "players": players_df, "teams": teams(table), "shrink": shrink, "checks": gate(table, players_df)}
