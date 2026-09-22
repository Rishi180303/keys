import polars as pl
import pytest

from keys import data


def test_parse_weeks():
    assert data.parse_weeks("3") == [3] and data.parse_weeks("1-3") == [1, 2, 3]


def test_validate_accepts_fixture(synthetic_play):
    data.validate(*synthetic_play)


def test_validate_rejects_missing_output(synthetic_play):
    inp, out = synthetic_play
    with pytest.raises(ValueError, match="output rows"):
        data.validate(inp, out.filter(pl.col("nfl_id") != 3))


def test_validate_rejects_frame_gap(synthetic_play):
    inp, out = synthetic_play
    with pytest.raises(ValueError, match="contiguous"):
        data.validate(inp.filter(~((pl.col("nfl_id") == 2) & (pl.col("frame_id") == 5))), out)


def test_angle_convention_on_fixture(synthetic_play):
    a, b = data.angle_errors(synthetic_play[0])
    assert a < 1e-9 and b > 0.1


real = pytest.mark.skipif(not (data.RAW / "input_2023_w01.csv").exists(), reason="raw data missing")


@real
def test_week_one_passes_validation():
    inp, out = data.load_week_raw(1)
    data.validate(inp, out)
    assert inp["player_to_predict"].dtype == pl.Boolean
    a, b = data.angle_errors(inp)
    assert a < 0.05 and b > 0.5
