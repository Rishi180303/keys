"""Raw csv to validated parquet, and loading."""

from pathlib import Path

import numpy as np
import polars as pl

from keys import KEY

RAW = Path("nfl-big-data-bowl-2026-prediction/train")
PROCESSED = Path("data/processed")
INPUT_COLUMNS = [
    "game_id", "play_id", "player_to_predict", "nfl_id", "frame_id", "play_direction",
    "absolute_yardline_number", "player_name", "player_height", "player_weight", "player_birth_date",
    "player_position", "player_side", "player_role", "x", "y", "s", "a", "dir", "o",
    "num_frames_output", "ball_land_x", "ball_land_y",
]
OUTPUT_COLUMNS = ["game_id", "play_id", "nfl_id", "frame_id", "x", "y"]


def parse_weeks(text: str) -> list[int]:
    """'3' -> [3], '1-18' -> [1, ..., 18]."""
    if "-" in text:
        lo, hi = (int(v) for v in text.split("-"))
        return list(range(lo, hi + 1))
    return [int(text)]


def load_week_raw(week: int) -> tuple[pl.DataFrame, pl.DataFrame]:
    inp = pl.read_csv(RAW / f"input_2023_w{week:02d}.csv", schema_overrides={"player_to_predict": pl.Utf8})
    inp = inp.with_columns(player_to_predict=pl.col("player_to_predict").str.to_lowercase() == "true")
    out = pl.read_csv(RAW / f"output_2023_w{week:02d}.csv")
    return inp, out


def angle_errors(inp: pl.DataFrame) -> tuple[float, float]:
    """Yards per frame error of two velocity conventions against actual displacement, on rows faster than 1 yd/s.

    A is vx = s*sin(dir), vy = s*cos(dir). B is the swap. A must win by a wide margin."""
    df = inp.sort(KEY + ["frame_id"]).with_columns(
        dx=pl.col("x").shift(-1).over(KEY) - pl.col("x"),
        dy=pl.col("y").shift(-1).over(KEY) - pl.col("y"),
        rad=pl.col("dir").radians(),
    )
    df = df.filter(pl.col("dx").is_not_null() & (pl.col("s") > 1))
    if df.height == 0:
        return 0.0, 0.0
    s, rad, dx, dy = (df[c].to_numpy() for c in ("s", "rad", "dx", "dy"))
    a = np.sqrt(np.mean((dx - 0.1 * s * np.sin(rad)) ** 2 + (dy - 0.1 * s * np.cos(rad)) ** 2))
    b = np.sqrt(np.mean((dx - 0.1 * s * np.cos(rad)) ** 2 + (dy - 0.1 * s * np.sin(rad)) ** 2))
    return float(a), float(b)


def validate(inp: pl.DataFrame, out: pl.DataFrame) -> None:
    """The facts from the spec. Raises ValueError with the first one that fails."""
    missing = set(INPUT_COLUMNS) - set(inp.columns)
    if missing:
        raise ValueError(f"input is missing columns {sorted(missing)}")
    missing = set(OUTPUT_COLUMNS) - set(out.columns)
    if missing:
        raise ValueError(f"output is missing columns {sorted(missing)}")
    frames = inp.group_by(KEY).agg(pl.col("frame_id").min().alias("lo"), pl.col("frame_id").max().alias("hi"), pl.len().alias("n"))
    bad = frames.filter((pl.col("lo") != 1) | (pl.col("hi") != pl.col("n")))
    if bad.height:
        raise ValueError(f"{bad.height} players have non contiguous input frames, first {bad.row(0)}")
    predicted = inp.filter(pl.col("player_to_predict")).group_by(KEY).agg(pl.col("num_frames_output").first())
    counts = out.group_by(KEY).agg(pl.len().alias("n"))
    joined = predicted.join(counts, on=KEY, how="full", coalesce=True)
    bad = joined.filter(pl.col("n").is_null() | pl.col("num_frames_output").is_null() | (pl.col("n") != pl.col("num_frames_output")))
    if bad.height:
        raise ValueError(f"{bad.height} players whose output rows do not match num_frames_output, first {bad.row(0)}")
    a, b = angle_errors(inp)
    if not a < b / 5:
        raise ValueError(f"angle convention check failed: {a:.3f} vs {b:.3f} yards per frame")


def prepare_week(week: int) -> None:
    inp, out = load_week_raw(week)
    validate(inp, out)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    inp.write_parquet(PROCESSED / f"input_w{week:02d}.parquet")
    out.write_parquet(PROCESSED / f"output_w{week:02d}.parquet")


def load_week(week: int) -> tuple[pl.DataFrame, pl.DataFrame]:
    return pl.read_parquet(PROCESSED / f"input_w{week:02d}.parquet"), pl.read_parquet(PROCESSED / f"output_w{week:02d}.parquet")


def load_weeks(weeks, columns=None, games=None) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Concatenate weeks from parquet. columns restricts the input columns, games restricts to those game ids."""
    inps, outs = [], []
    for w in weeks:
        i = pl.scan_parquet(PROCESSED / f"input_w{w:02d}.parquet")
        o = pl.scan_parquet(PROCESSED / f"output_w{w:02d}.parquet")
        if games is not None:
            i, o = i.filter(pl.col("game_id").is_in(games)), o.filter(pl.col("game_id").is_in(games))
        if columns is not None:
            i = i.select(columns)
        inps.append(i.collect())
        outs.append(o.collect())
    return pl.concat(inps), pl.concat(outs)
