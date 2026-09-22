"""Rotate every play so the offense moves toward positive x, and add velocities."""

import polars as pl

FIELD_X, FIELD_Y = 120.0, 53.3


def _flip(col: str, size: float, left: pl.Expr) -> pl.Expr:
    return pl.when(left).then(size - pl.col(col)).otherwise(pl.col(col)).alias(col)


def _turn(col: str, left: pl.Expr) -> pl.Expr:
    return pl.when(left).then((pl.col(col) + 180.0) % 360.0).otherwise(pl.col(col)).alias(col)


def normalize(inp: pl.DataFrame) -> pl.DataFrame:
    """Rotate plays that run left by 180 degrees. Applying it twice returns the original.

    Adds rx, ry relative to the landing spot and vx, vy from speed and direction."""
    left = pl.col("play_direction") == "left"
    df = inp.with_columns(
        _flip("x", FIELD_X, left), _flip("y", FIELD_Y, left),
        _flip("ball_land_x", FIELD_X, left), _flip("ball_land_y", FIELD_Y, left),
        _turn("dir", left), _turn("o", left),
    )
    return df.with_columns(
        rx=pl.col("x") - pl.col("ball_land_x"),
        ry=pl.col("y") - pl.col("ball_land_y"),
        vx=pl.col("s") * pl.col("dir").radians().sin(),
        vy=pl.col("s") * pl.col("dir").radians().cos(),
    )


def normalize_targets(out: pl.DataFrame, inp: pl.DataFrame) -> pl.DataFrame:
    """Rotate target rows the same way, using each play's direction from the input."""
    dirs = inp.select("game_id", "play_id", "play_direction").unique()
    df = out.join(dirs, on=["game_id", "play_id"], how="left")
    left = pl.col("play_direction") == "left"
    return df.with_columns(_flip("x", FIELD_X, left), _flip("y", FIELD_Y, left))


def denormalize(df: pl.DataFrame) -> pl.DataFrame:
    """Undo the rotation on x_pred, y_pred using the play_direction column."""
    left = pl.col("play_direction") == "left"
    return df.with_columns(_flip("x_pred", FIELD_X, left), _flip("y_pred", FIELD_Y, left))
