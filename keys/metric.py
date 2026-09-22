"""Kaggle's metric and the standard report cuts."""

import numpy as np
import polars as pl

from keys import KEY


def kaggle_rmse(x_true, y_true, x_pred, y_pred) -> float:
    """sqrt(0.5 * (mse_x + mse_y)), the competition metric, in yards."""
    xt, yt, xp, yp = (np.asarray(a, dtype=float) for a in (x_true, y_true, x_pred, y_pred))
    return float(np.sqrt(0.5 * (np.mean((xt - xp) ** 2) + np.mean((yt - yp) ** 2))))


def report(df: pl.DataFrame) -> dict[str, float]:
    """Metric on the standard cuts. df needs x, y, x_pred, y_pred, player_role, frame_id, num_frames_output."""
    cuts = {"all": pl.lit(True), "le40": pl.col("num_frames_output") <= 40}
    for role in df["player_role"].unique().sort().to_list():
        cuts["role_" + role.replace(" ", "_")] = pl.col("player_role") == role
    for k in (5, 10, 20, 30):
        cuts[f"frame_{k}"] = pl.col("frame_id") == k
    out = {}
    for name, cond in cuts.items():
        sub = df.filter(cond)
        if sub.height:
            out[name] = kaggle_rmse(sub["x"], sub["y"], sub["x_pred"], sub["y_pred"])
    return out


def evaluate_predictions(pred: pl.DataFrame, inp: pl.DataFrame, out: pl.DataFrame) -> dict[str, float]:
    """Join x_pred, y_pred onto every target row and report. Fails if any target row has no prediction."""
    meta = inp.select(KEY + ["player_role", "num_frames_output"]).unique(subset=KEY)
    pred_select = pred.select(KEY + ["frame_id", "x_pred", "y_pred"])

    # Check for missing predictions using anti-join
    missing = out.join(pred_select, on=KEY + ["frame_id"], how="anti")
    if missing.height > 0:
        raise ValueError(f"{missing.height} target rows have no predictions")

    # Perform the join
    df = out.join(pred_select, on=KEY + ["frame_id"], how="inner")

    # Check for duplicate predictions
    if df.height != out.height:
        raise ValueError(f"predictions cover {df.height} of {out.height} target rows")

    df = df.join(meta, on=KEY, how="left")
    return report(df)


def markdown_table(results: dict[str, dict[str, float]]) -> str:
    """One row per cut, one column per named result."""
    names = list(results)
    cuts = list(dict.fromkeys(c for r in results.values() for c in r))
    lines = ["| cut | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for c in cuts:
        cells = [f"{results[n][c]:.3f}" if c in results[n] else "" for n in names]
        lines.append(f"| {c} | " + " | ".join(cells) + " |")
    return "\n".join(lines)
