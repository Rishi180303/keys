import polars as pl

from keys.features import FIELD_X, FIELD_Y, denormalize, normalize, normalize_targets
from keys.metric import kaggle_rmse


def _as_left(inp):
    return inp.with_columns(play_direction=pl.lit("left"))


def test_right_plays_untouched(synthetic_play):
    inp, _ = synthetic_play
    n = normalize(inp)
    assert n["x"].to_list() == inp["x"].to_list() and n["dir"].to_list() == inp["dir"].to_list()


def test_left_play_moves_toward_positive_x(synthetic_play):
    inp, _ = synthetic_play
    n = normalize(_as_left(inp)).filter(pl.col("nfl_id") == 2)
    assert n["x"][0] == FIELD_X - 50.0 and n["y"][0] == FIELD_Y - 20.0
    assert abs(n["dir"][0] - 270.0) < 1e-9 and n["vx"][0] < 0


def test_normalize_is_its_own_inverse(synthetic_play):
    inp, _ = synthetic_play
    twice = normalize(normalize(_as_left(inp)))
    for c in ("x", "y", "dir", "o", "ball_land_x", "ball_land_y"):
        assert all(abs(a - b) < 1e-9 for a, b in zip(twice[c].to_list(), _as_left(inp)[c].to_list()))


def test_velocity_matches_displacement(synthetic_play):
    inp, _ = synthetic_play
    n = normalize(inp).sort(["nfl_id", "frame_id"])
    r = n.filter(pl.col("nfl_id") == 2)
    assert abs(r["vx"][0] * 0.1 - (r["x"][1] - r["x"][0])) < 1e-9


def test_rotation_leaves_metric_unchanged(synthetic_play):
    inp, out = synthetic_play
    left_inp = _as_left(inp)
    pred = out.with_columns(x_pred=pl.col("x") + 1.0, y_pred=pl.col("y") - 2.0)
    before = kaggle_rmse(out["x"], out["y"], pred["x_pred"], pred["y_pred"])
    tgt = normalize_targets(out, left_inp)
    rot = normalize_targets(pred.drop("x", "y").rename({"x_pred": "x", "y_pred": "y"}), left_inp)
    after = kaggle_rmse(tgt["x"], tgt["y"], rot["x"], rot["y"])
    assert abs(before - after) < 1e-9
    back = denormalize(rot.rename({"x": "x_pred", "y": "y_pred"}))
    assert abs(back["x_pred"][0] - pred["x_pred"][0]) < 1e-9
