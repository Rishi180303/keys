import json

import polars as pl
import pytest
from conftest import PEOPLE

from keys import photos
from keys.rate import MIN_PLAYS

RAMSEY, TERRELL, MOSLEY = "File:Jalen Ramsey 2014.jpg", "File:A.J. Terrell.jpg", "File:C.J.Mosley.png"
SURTAIN = ["File:PSII2025.webp", "File:Patrick Surtain 2021 (51650411936) (cropped).jpg", "File:Patrick Surtain II.jpg"]


def test_roster_is_the_listed_defenders_with_their_birth_dates():
    rows = [(1, "Listed One", None)] * MIN_PLAYS + [(2, "One Short", None)] * (MIN_PLAYS - 1)
    rows += [(2, "One Short", "out of bounds")] * 5 + [(3, "No Frames", None)] * (MIN_PLAYS + 1)
    table = pl.DataFrame(rows, schema={"nfl_id": pl.Int64, "name": pl.String, "ex": pl.String}, orient="row")
    inp = pl.DataFrame({"nfl_id": [1, 1, 2], "player_birth_date": ["1999-07-12", "1999-07-12", "2000-01-01"]})
    assert photos.roster(table, inp) == [
        {"id": 1, "name": "Listed One", "born": "1999-07-12"}, {"id": 3, "name": "No Frames", "born": None},
    ]


@pytest.mark.parametrize(("kaggle", "wikidata"), [
    ("A.J. Terrell", "A. J. Terrell"), ("Kenneth Murray, Jr.", "Kenneth Murray"), ("Tre'von Moehrig", "Trevon Moehrig"),
    ("DJ Turner II", "DJ Turner"), ("Asante Samuel", "Asante Samuel Jr."), ("Jose Ramirez", "José Ramírez"),
])
def test_plain_sees_through_punctuation_accents_and_suffixes(kaggle, wikidata):
    assert photos.plain(kaggle) == photos.plain(wikidata)


def test_plain_keeps_different_names_apart():
    assert photos.plain("Devin McCourty") != photos.plain("Jason McCourty")
    assert photos.plain("Pat Surtain II") != photos.plain("Patrick Surtain II") and photos.plain("V") == "v"


def test_match_needs_the_name_and_the_birth_date(wikimedia):
    calls, _ = wikimedia
    assert photos.match(PEOPLE) == {
        11: {"items": ["Q18631600"], "titles": [RAMSEY]},
        12: {"items": ["Q73699733"], "titles": [TERRELL]},
        13: {"items": ["Q73966581"], "titles": SURTAIN},
        14: {"items": ["Q5006569"], "titles": [MOSLEY]},
        15: {"items": ["Q97331000"], "titles": []},
    }
    [(url, form)] = calls
    dates = sorted({p["born"] for p in PEOPLE if p["born"]})
    assert url == photos.SPARQL and form["format"] == "json" and "None" not in form["query"]
    assert [form["query"].count(f'"{d}T00:00:00Z"') for d in dates] == [1] * 6


def test_match_asks_for_a_hundred_dates_at_a_time(wikimedia):
    calls, answers = wikimedia
    answers[photos.SPARQL] = b'{"results": {"bindings": []}}'
    people = [{"id": i, "name": "N", "born": f"19{70 + i // 12}-{i % 12 + 1:02d}-01"} for i in range(150)]
    assert photos.match(people) == {}
    assert [form["query"].count("xsd:dateTime") for _, form in calls] == [100, 50]


def test_match_never_sends_what_is_not_a_date(wikimedia):
    calls, _ = wikimedia
    people = [{"id": 1, "name": "A.J. Terrell", "born": '1998-09-23" } #'}, {"id": 2, "name": "No Birthday", "born": None}]
    assert photos.match(people) == {} and calls == []


def test_match_ignores_a_name_with_no_letters_left(wikimedia):
    _, answers = wikimedia
    row = {"born": {"value": "1998-09-23T00:00:00Z"}, "item": {"value": "http://www.wikidata.org/entity/Q1"}, "name": {"value": "\u5c71\u7530"}}
    answers[photos.SPARQL] = json.dumps({"results": {"bindings": [row]}}).encode()
    assert photos.plain("\u5c71\u7530") == "" and photos.plain("...") == ""
    assert photos.match([{"id": 1, "name": "...", "born": "1998-09-23"}, {"id": 2, "name": None, "born": "1998-09-23"}]) == {}
