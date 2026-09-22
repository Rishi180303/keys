"""Physics baselines from the last input frame, in normalized coordinates."""

import polars as pl

from keys import KEY
from keys.features import normalize, normalize_targets
from keys.metric import evaluate_predictions

LAST_COLUMNS = KEY + ["frame_id", "x", "y", "vx", "vy", "ball_land_x", "ball_land_y", "num_frames_output", "player_role"]


def last_frame(inp: pl.DataFrame) -> pl.DataFrame:
    """One row per predicted player: the last input frame. inp must already be normalized."""
    return (
        inp.filter(pl.col("player_to_predict"))
        .sort(KEY + ["frame_id"])
        .group_by(KEY, maintain_order=True)
        .last()
        .select(LAST_COLUMNS)
    )


def _frames(last: pl.DataFrame) -> pl.DataFrame:
    """Expand each player to one row per future frame k = 1..num_frames_output."""
    return last.drop("frame_id").with_columns(frame_id=pl.int_ranges(1, pl.col("num_frames_output") + 1)).explode("frame_id", empty_as_null=False)


def _cv(axis: str) -> pl.Expr:
    return pl.col(axis) + 0.1 * pl.col("frame_id") * pl.col("v" + axis)


def hold(last: pl.DataFrame) -> pl.DataFrame:
    return _frames(last).with_columns(x_pred=pl.col("x"), y_pred=pl.col("y"))


def constant_velocity(last: pl.DataFrame) -> pl.DataFrame:
    return _frames(last).with_columns(x_pred=_cv("x"), y_pred=_cv("y"))


def hybrid(last: pl.DataFrame) -> pl.DataFrame:
    """Constant velocity for everyone except the targeted receiver, who runs straight to the landing spot."""
    t = pl.col("frame_id") / pl.col("num_frames_output")
    recv = pl.col("player_role") == "Targeted Receiver"
    return _frames(last).with_columns(
        x_pred=pl.when(recv).then(pl.col("x") + (pl.col("ball_land_x") - pl.col("x")) * t).otherwise(_cv("x")),
        y_pred=pl.when(recv).then(pl.col("y") + (pl.col("ball_land_y") - pl.col("y")) * t).otherwise(_cv("y")),
    )


BASELINES = {"hold": hold, "constant_velocity": constant_velocity, "hybrid": hybrid}


def baseline_reports(inp: pl.DataFrame, out: pl.DataFrame) -> dict[str, dict[str, float]]:
    """Every baseline's report on raw input and output frames."""
    inp = normalize(inp)
    out = normalize_targets(out, inp)
    last = last_frame(inp)
    return {name: evaluate_predictions(fn(last), inp, out) for name, fn in BASELINES.items()}
