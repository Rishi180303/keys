import polars as pl

from keys.baselines import BASELINES, baseline_reports, constant_velocity, hold, last_frame
from keys.features import normalize


def test_last_frame_one_row_per_predicted_player(synthetic_play):
    last = last_frame(normalize(synthetic_play[0]))
    assert last.height == 2 and last["frame_id"].to_list() == [12, 12]


def test_constant_velocity_is_exact_on_fixture(synthetic_play):
    reports = baseline_reports(*synthetic_play)
    assert reports["constant_velocity"]["all"] < 1e-9
    assert reports["hold"]["all"] > 1.0
    assert set(reports) == set(BASELINES)


def test_expansion_has_one_row_per_future_frame(synthetic_play):
    last = last_frame(normalize(synthetic_play[0]))
    assert hold(last).height == 12 and constant_velocity(last)["frame_id"].max() == 6
    assert hold(last).filter(pl.col("nfl_id") == 2)["x_pred"].n_unique() == 1
