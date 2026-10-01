import json

import polars as pl
from polars.testing import assert_frame_equal

from keys import data, rate, site


def _table(rating_play):
    inp, out, pred, sup = rating_play
    return rate.center(rate.play_table(inp, out, pred, sup))


def test_plays_json_is_columnar_and_rounded(rating_play):
    table = _table(rating_play)
    pj = site.plays_json(table)
    assert pj["columns"][:4] == ["game", "play", "week", "id"] and pj["columns"][-3:] == ["z", "zc", "ex"]
    assert len(pj["rows"]) == 2
    row = dict(zip(pj["columns"], pj["rows"][0]))
    assert row["id"] == 3 and row["yards"] == 1.0 and row["ex"] is None and row["air"] == 6 and row["role"] == "primary"
    assert row["team"] == "KC" and row["cov"] == "COVER_3_ZONE" and row["mz"] == "zone" and row["epa"] == 0.5
    assert all(isinstance(v, (int, float, str, type(None))) for v in pj["rows"][0])
    # zc keeps six decimals so the site's tiers match rate.py; two decimals flipped a player 1.4e-05 from the line
    exact = site.plays_json(table.with_columns(zc=pl.lit(0.1234567)))
    assert dict(zip(exact["columns"], exact["rows"][0]))["zc"] == 0.123457 and row["d0"] == round(table["d0"][0], 2)


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


def _reel_inputs(rows):
    """A rated table and its game files from (game, play, id, grp, air frames, role, zc, ex, dexp) rows.

    Every defender ends one yard from the ball, so a dexp above one means he beat the expectation."""
    base = {
        "week": 1, "name": "N", "pos": "CB", "team": "KC", "cov": "c", "mz": "zone", "route": "GO", "result": "C",
        "epa": 0.0, "d0": 9.0, "dact": 1.0, "yards": 2.0, "z": 1.0,
    }
    names = ["game_id", "play_id", "nfl_id", "grp", "frames", "role", "zc", "ex", "dexp"]
    table = pl.DataFrame([{**base, **dict(zip(names, r))} for r in rows], schema_overrides={"ex": pl.String})
    games = {}
    for game, play, *_ in rows:
        g = games.setdefault(game, {"game": game, "week": 1, "home": "KC", "away": "DET", "plays": []})
        g["plays"].append({"play": play, "players": []})
    return table, games


def test_highlights_take_two_per_group_then_the_best_of_the_rest(monkeypatch):
    monkeypatch.setattr(site, "MIN_PLAYS", 2)
    groups = {1: "CB", 2: "CB", 3: "CB", 4: "CB", 5: "S", 6: "S", 7: "S", 8: "LB", 9: "LB"}
    rows = [
        (1, 10, 1, "CB", 20, "primary", 3.0, None, 3.0),
        (1, 11, 1, "CB", 20, "primary", 2.95, None, 3.0),  # his second best never shows: one play per player
        (1, 12, 2, "CB", 15, "primary", 2.9, None, 3.0),  # fifteen air frames is enough
        (2, 14, 3, "CB", 20, "primary", 2.8, None, 3.0),
        (1, 15, 4, "CB", 20, "primary", 2.8, None, 3.0),  # ties with player 3 and wins on the game id
        (1, 16, 5, "S", 20, "primary", 1.0, None, 3.0),
        (1, 17, 6, "S", 20, "primary", 0.9, None, 3.0),
        (1, 18, 7, "S", 20, "primary", 0.8, None, 3.0),
        (1, 19, 8, "LB", 20, "primary", 0.5, None, 3.0),
        (1, 20, 9, "LB", 20, "primary", 0.5, None, 3.0),  # ties with player 8 inside one game: the play id decides
        (1, 21, 10, "CB", 20, "primary", 9.0, None, 3.0),  # his only rated play, so he is not listed
        (1, 22, 2, "CB", 14, "primary", 8.0, None, 3.0),  # too short in the air
        (1, 23, 2, "CB", 20, "help", 7.0, None, 3.0),  # not the primary defender
        (1, 24, 2, "CB", 20, "primary", 6.0, "not catchable", 3.0),  # not rated
        (1, 25, 2, "CB", 20, "primary", 5.0, None, 1.0),  # no nearer the ball than expected
        (1, 26, 11, "S", 20, "primary", 4.0, None, 3.0),  # one rated play and one excluded: not listed
        (1, 27, 11, "S", 20, "primary", 0.0, "not catchable", 3.0),
    ]
    rows += [(3, 100 + i, i, grp, 20, "help", 0.0, None, 3.0) for i, grp in groups.items()]
    table, games = _reel_inputs(rows[::-1])  # worst first, so the order has to come from the sort
    reel = site.highlights(table, games)
    assert [h["play"] for h in reel] == [10, 12, 15, 14, 16, 17, 19, 20]
    assert [h["scene"]["play"] for h in reel] == [h["play"] for h in reel]  # each entry carries its own play
    assert [h["play"] for h in site.highlights(table, games, n=7)] == [10, 12, 15, 16, 17, 19, 20]
    assert [h["play"] for h in site.highlights(table, games, n=4)] == [10, 12, 16, 17]
    assert [h["play"] for h in site.highlights(table, games, n=20)] == [10, 12, 15, 14, 16, 17, 18, 19, 20]


def test_highlight_entries_carry_the_play_with_trimmed_input(rating_play, monkeypatch):
    inp, out, pred, sup = rating_play
    table = _table(rating_play)
    games = site.games_json(inp, out, pred, table, sup)
    assert site.highlights(table, games) == []  # nobody in a one play season has thirty rated plays
    monkeypatch.setattr(site, "MIN_PLAYS", 1)
    monkeypatch.setattr(site, "HIGHLIGHT_AIR", 6)
    [entry] = site.highlights(table, games)
    scene, play = entry.pop("scene"), games[1]["plays"][0]
    assert entry == {
        "game": 1, "play": 1, "week": 1, "home": "KC", "away": "DET", "id": 3, "name": "Defender", "pos": "CB",
        "team": "KC", "zc": 0.0, "yards": 1.0, "dexp": round(table["dexp"][0], 2), "dact": round(table["dact"][0], 2),
    }
    assert [p["in"] for p in scene["players"]] == [[f[:2] for f in p["in"]] for p in play["players"]]
    assert len(scene["players"][0]["in"][0]) == 2 and len(play["players"][0]["in"][0]) == 6  # the game file keeps all six
    assert [{**p, "in": None} for p in scene["players"]] == [{**p, "in": None} for p in play["players"]]
    assert {**scene, "players": None} == {**play, "players": None}
    assert json.loads(site._dump([entry]))[0]["id"] == 3


def test_write_site_and_meta(tmp_path, rating_play):
    inp, out, pred, sup = rating_play
    res = rate.compute(inp, out, pred, sup)
    stale = tmp_path / "site" / "games" / "999.json"
    stale.parent.mkdir(parents=True)
    stale.write_text("{}")
    meta = site.meta_json("run1", "https://x.invalid/predict", {"le40": {"mean": 0.5}}, res, "2026-09-24T00:00:00Z")
    games = site.games_json(inp, out, pred, res["table"], sup)
    files = site.write_site(tmp_path / "site", site.plays_json(res["table"]), games, meta, [{"game": 1, "play": 1}])
    assert not stale.exists()
    assert [f.name for f in files] == ["plays.json", "meta.json", "highlights.json", "1.json"] and files[3].parent.name == "games"
    assert files[2].read_text() == '[{"game":1,"play":1}]'
    m = json.loads(files[1].read_text())
    assert m["run"] == "run1" and m["api_url"] == "https://x.invalid/predict" and m["summary"] == {"le40": {"mean": 0.5}}
    assert m["gate"]["passed"] is False and set(m["shrink"]) == {"CB", "S"} and m["min_plays"] == 30
    assert m["counts"] == {"plays": 1, "games": 1} and m["generated"] == "2026-09-24T00:00:00Z"
    plays = json.loads(files[0].read_text())
    assert len(plays["rows"]) == 2 and "\n" not in files[0].read_text()
