import json

import polars as pl
from polars.testing import assert_frame_equal

from keys import data, rate, site


def _table(rating_play):
    inp, out, pred, sup = rating_play
    return rate.center(rate.play_table(inp, out, pred, sup))


def test_plays_json_is_columnar_and_rounded(rating_play):
    pj = site.plays_json(_table(rating_play))
    assert pj["columns"][:4] == ["game", "play", "week", "id"] and pj["columns"][-3:] == ["z", "zc", "ex"]
    assert len(pj["rows"]) == 2
    row = dict(zip(pj["columns"], pj["rows"][0]))
    assert row["id"] == 3 and row["yards"] == 1.0 and row["ex"] is None and row["air"] == 6 and row["role"] == "primary"
    assert row["team"] == "KC" and row["cov"] == "COVER_3_ZONE" and row["mz"] == "zone" and row["epa"] == 0.5
    assert all(isinstance(v, (int, float, str, type(None))) for v in pj["rows"][0])


def test_game_file_round_trips_the_input_rows(rating_play):
    inp, out, pred, sup = rating_play
    games = site.games_json(inp, out, pred, _table(rating_play), sup)
    assert list(games) == [1]
    g = games[1]
    play = g["plays"][0]
    assert g["home"] == "KC" and g["away"] == "DET" and g["week"] == 1 and len(g["plays"]) == 1
    assert play["def"] == "KC" and play["off"] == "DET" and play["nfo"] == 6 and play["land"] == [60.0, 20.0]
    assert play["desc"] == "pass" and play["dir"] == "right" and play["yl"] == 50 and play["route"] == "GO"
    assert [p["id"] for p in play["players"]] == [1, 2, 3, 4]
    passer, receiver, defender = play["players"][0], play["players"][1], play["players"][2]
    assert "out" not in passer and "pred" not in passer and len(passer["in"]) == 12 and len(passer["in"][0]) == 6
    assert len(receiver["out"]) == 6 and len(receiver["out"][0]) == 2 and len(defender["pred"]) == 6 and len(defender["pred"][0]) == 4
    assert defender["pred"][-1][2] == 0.5 and defender["p"] is True and passer["p"] is False
    assert [r["id"] for r in play["ratings"]] == [3, 4] and play["ratings"][0]["yards"] == 1.0 and play["ratings"][1]["role"] == "help"
    rows = pl.DataFrame(site.api_rows(g, play)).select(data.INPUT_COLUMNS).sort("nfl_id", "frame_id")
    expected = inp.select(data.INPUT_COLUMNS).sort("nfl_id", "frame_id")
    assert_frame_equal(rows, expected, check_dtypes=False, abs_tol=0.006)


def test_write_site_and_meta(tmp_path, rating_play):
    inp, out, pred, sup = rating_play
    res = rate.compute(inp, out, pred, sup)
    meta = site.meta_json("run1", "https://x.invalid/predict", {"le40": {"mean": 0.5}}, res, "2026-09-24T00:00:00Z")
    files = site.write_site(tmp_path / "site", site.plays_json(res["table"]), site.games_json(inp, out, pred, res["table"], sup), meta)
    assert [f.name for f in files] == ["plays.json", "meta.json", "1.json"] and files[2].parent.name == "games"
    m = json.loads(files[1].read_text())
    assert m["run"] == "run1" and m["api_url"] == "https://x.invalid/predict" and m["summary"] == {"le40": {"mean": 0.5}}
    assert m["gate"]["passed"] is False and set(m["shrink"]) == {"CB", "S"} and m["min_plays"] == 30
    assert m["counts"] == {"plays": 1, "games": 1} and m["generated"] == "2026-09-24T00:00:00Z"
    plays = json.loads(files[0].read_text())
    assert len(plays["rows"]) == 2 and "\n" not in files[0].read_text()
