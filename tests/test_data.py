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


def test_validate_rejects_bad_play_direction(synthetic_play):
    inp, out = synthetic_play
    bad = inp.with_columns(
        play_direction=pl.when((pl.col("nfl_id") == 1) & (pl.col("frame_id") == 1))
        .then(pl.lit("up"))
        .otherwise(pl.col("play_direction"))
    )
    with pytest.raises(ValueError, match="play_direction"):
        data.validate(bad, out)


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


def test_load_weeks_columns_and_games(synthetic_play, monkeypatch, tmp_path):
    inp, out = synthetic_play
    monkeypatch.setattr(data, "PROCESSED", tmp_path)
    inp.write_parquet(tmp_path / "input_w01.parquet")
    out.write_parquet(tmp_path / "output_w01.parquet")
    i, o = data.load_weeks([1], columns=["x", "y"], games=[1])
    assert list(i.columns) == ["x", "y"] and i.height == 36
    assert o.height == 12
    i_empty, o_empty = data.load_weeks([1], columns=["x", "y"], games=[999])
    assert i_empty.height == 0 and o_empty.height == 0
