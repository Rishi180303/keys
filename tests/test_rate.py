import polars as pl
import pytest

from keys import rate

L = (60.0, 20.0)
HEADER = (
    "game_id,play_id,week,home_team_abbr,visitor_team_abbr,possession_team,defensive_team,play_description,quarter,"
    "game_clock,down,yards_to_go,pass_result,route_of_targeted_receiver,team_coverage_man_zone,team_coverage_type,"
    "expected_points_added,extra"
)


def test_load_supplementary_short_names_and_unknowns(tmp_path):
    csv = tmp_path / "sup.csv"
    csv.write_text(
        HEADER + "\n1,1,1,KC,DET,DET,KC,pass short right,1,15:00,1,10,C,GO,ZONE_COVERAGE,COVER_3_ZONE,0.5,x\n"
        "1,2,1,KC,DET,DET,KC,pass deep,1,14:00,2,7,I,NA,NA,NA,-0.4,y\n"
    )
    sup = rate.load_supplementary(csv)
    assert "extra" not in sup.columns and sup.height == 2
    one = sup.filter(pl.col("play_id") == 1).row(0, named=True)
    assert one["mz"] == "zone" and one["cov"] == "COVER_3_ZONE" and one["team"] == "KC" and one["off"] == "DET"
    assert one["desc"] == "pass short right" and one["epa"] == 0.5 and one["clock"] == "15:00" and one["dist"] == 10
    two = sup.filter(pl.col("play_id") == 2).row(0, named=True)
    assert two["mz"] == "unknown" and two["route"] == "unknown" and two["cov"] == "unknown" and two["result"] == "I"


def test_load_supplementary_rejects_duplicate_plays(tmp_path):
    csv = tmp_path / "sup.csv"
    row = "1,1,1,KC,DET,DET,KC,pass,1,15:00,1,10,C,GO,ZONE_COVERAGE,COVER_3_ZONE,0.5,x\n"
    csv.write_text(HEADER + "\n" + row + row)
    with pytest.raises(ValueError, match="unique"):
        rate.load_supplementary(csv)


def _geo(x0, y0, xp, yp, x, y, sdx=0.5, sdy=0.5):
    df = pl.DataFrame({
        "x0": [x0], "y0": [y0], "x_pred": [xp], "y_pred": [yp], "sd_x": [sdx], "sd_y": [sdy], "x": [x], "y": [y],
        "ball_land_x": [L[0]], "ball_land_y": [L[1]],
    })
    return rate.geometry(df).row(0, named=True)


def test_geometry_yards_closer_along_the_line_to_the_ball():
    # expected five yards short of the ball along x, actual one yard closer than expected
    r = _geo(50.0, 20.0, 55.0, 20.0, 56.0, 20.0)
    assert r["dexp"] == 5 and r["dact"] == 4 and r["d0"] == 10
    assert r["yards"] == pytest.approx(1.0) and r["sdu"] == pytest.approx(0.5) and r["z"] == pytest.approx(2.0)


def test_geometry_sideways_error_counts_nothing():
    r = _geo(50.0, 20.0, 55.0, 20.0, 55.0, 23.0)
    assert r["yards"] == pytest.approx(0.0) and r["dact"] > r["dexp"]


def test_geometry_falls_back_to_the_throw_line_near_the_ball():
    # expected half a yard short of the ball, so u runs from the throw position, due west of the ball
    r = _geo(50.0, 20.0, 59.5, 20.0, 60.5, 20.0)
    assert r["yards"] == pytest.approx(1.0)


def test_geometry_uses_the_spread_along_u():
    r = _geo(50.0, 20.0, 55.0, 20.0, 56.0, 20.0, sdx=2.0, sdy=0.1)
    assert r["sdu"] == pytest.approx(2.0) and r["z"] == pytest.approx(0.5)


def test_exclusion_reasons_in_priority_order():
    df = pl.DataFrame({
        "num_frames_output": [41, 10, 10, 10, 41], "ball_land_x": [60.0, -1.0, 60.0, 60.0, -1.0],
        "ball_land_y": [20.0, 20.0, 60.0, 20.0, 20.0], "recv_dist": [0.0, 0.0, 0.0, 4.5, 9.0],
    })
    expected = ["over 40 frames", "out of bounds", "out of bounds", "not catchable", "over 40 frames"]
    assert df.with_columns(rate.exclusion())["ex"].to_list() == expected
    ok = pl.DataFrame({"num_frames_output": [40], "ball_land_x": [0.0], "ball_land_y": [53.3], "recv_dist": [4.0]})
    assert ok.with_columns(rate.exclusion())["ex"].to_list() == [None]


def test_play_table_geometry_role_and_context(rating_play):
    from keys import train

    inp, out, pred, sup = rating_play
    t = rate.play_table(inp, out, pred, sup)
    assert t.height == 2 and t["nfl_id"].to_list() == [3, 4]
    a, b = t.row(0, named=True), t.row(1, named=True)
    assert a["yards"] == pytest.approx(1.0) and a["z"] == pytest.approx(2.0) and a["role"] == "primary" and a["grp"] == "CB"
    assert b["yards"] == pytest.approx(-0.5) and b["z"] == pytest.approx(-1.0) and b["role"] == "help" and b["grp"] == "S"
    assert a["ex"] is None and a["air"] == "5-8" and a["start"] == "5-10" and b["start"] == "10-20"
    assert a["team"] == "KC" and a["route"] == "GO" and a["result"] == "C" and a["frames"] == 6
    assert a["fold"] == train.fold_of(1) and a["name"] == "Defender" and b["pos"] == "FS" and a["week"] == 1


def test_play_table_rejects_missing_arrival_rows(rating_play):
    inp, out, pred, sup = rating_play
    with pytest.raises(ValueError, match="no arrival row"):
        rate.play_table(inp, out, pred.filter(pl.col("nfl_id") != 4), sup)


def test_play_table_rejects_a_play_without_one_receiver(rating_play):
    inp, out, pred, sup = rating_play
    role = pl.when(pl.col("nfl_id") == 4).then(pl.lit("Targeted Receiver")).otherwise(pl.col("player_role"))
    with pytest.raises(ValueError, match="exactly one targeted receiver"):
        rate.play_table(inp.with_columns(role.alias("player_role")), out, pred, sup)


def test_play_table_rejects_a_play_without_context(rating_play):
    inp, out, pred, sup = rating_play
    with pytest.raises(ValueError, match="no supplementary row"):
        rate.play_table(inp, out, pred, sup.filter(pl.col("play_id") != 1))
