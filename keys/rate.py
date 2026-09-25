"""Closing over expected: the per play table, situation centering, player and team ratings, and the gate.

Every function takes and returns polars frames and does no I/O, except load_supplementary."""

import numpy as np  # noqa: F401
import polars as pl

from keys import KEY  # noqa: F401
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
