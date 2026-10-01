import json
import urllib.error

import polars as pl
import pytest
from conftest import FIXTURES, IMAGE, PEOPLE

from keys import photos
from keys.rate import MIN_PLAYS

RAMSEY, TERRELL, MOSLEY = "File:Jalen Ramsey 2014.jpg", "File:A.J. Terrell.jpg", "File:C.J.Mosley.png"
SURTAIN = ["File:PSII2025.webp", "File:Patrick Surtain 2021 (51650411936) (cropped).jpg", "File:Patrick Surtain II.jpg"]
TITLES = sorted([RAMSEY, TERRELL, MOSLEY, *SURTAIN])


def _commons(change) -> bytes:
    """The recorded Commons answer after change(reply, image info by title) has edited it."""
    reply = json.loads((FIXTURES / "commons.json").read_text())
    change(reply, {p["title"]: p["imageinfo"][0] for p in reply["query"]["pages"]})
    return json.dumps(reply).encode()


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


def test_licensed_reads_the_thumbnail_the_credit_and_the_license(wikimedia):
    calls, _ = wikimedia
    free = photos.licensed(TITLES)
    assert sorted(free) == TITLES
    assert free[TERRELL] == {
        "thumb": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/df/A.J._Terrell.jpg/330px-A.J._Terrell.jpg"
        "?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
        "ext": "jpg", "artist": "Atlanta Falcons", "license": "CC BY 3.0",
        "license_url": "https://creativecommons.org/licenses/by/3.0",
        "source": "https://commons.wikimedia.org/wiki/File:A.J._Terrell.jpg",
    }
    assert free[MOSLEY]["ext"] == "png" and free[MOSLEY]["license"] == "Public domain" and free[MOSLEY]["license_url"] is None
    assert free[SURTAIN[0]]["ext"] == "webp" and free[SURTAIN[1]]["artist"] == "All-Pro Reels from District of Columbia, USA"
    [(url, form)] = calls
    assert url == photos.COMMONS and form["titles"] == "|".join(TITLES) and form["iiurlwidth"] == "320"


@pytest.mark.parametrize("name", ["CC BY 2.0", "CC BY-SA 4.0", "CC BY-SA 3.0 de", "cc by 4.0", "CC0", "CC0 1.0", "Public domain"])
def test_the_four_free_license_families_pass(name):
    assert photos.FREE.fullmatch(name)


@pytest.mark.parametrize("name", ["CC BY-NC 2.0", "CC BY-NC-SA 4.0", "CC BY-ND 2.0", "CC BY", "GFDL", "FAL", "Copyrighted free use", ""])
def test_every_other_license_fails(name):
    assert not photos.FREE.fullmatch(name)


def test_licensed_drops_what_the_site_may_not_show(wikimedia):
    _, answers = wikimedia

    def change(reply, info):
        info[TERRELL]["extmetadata"]["LicenseShortName"]["value"] = "CC BY-NC-SA 2.0"
        info[RAMSEY]["thumbmime"] = "image/tiff"
        info[MOSLEY]["extmetadata"]["LicenseUrl"] = {"value": "javascript:alert(1)"}
        del info[SURTAIN[1]]["extmetadata"]["LicenseShortName"]
        del next(p for p in reply["query"]["pages"] if p["title"] == SURTAIN[0])["imageinfo"]

    answers[photos.COMMONS] = _commons(change)
    free = photos.licensed(TITLES)
    assert sorted(free) == [MOSLEY, SURTAIN[2]] and free[MOSLEY]["license_url"] is None


def test_licensed_answers_under_the_title_it_was_asked(wikimedia):
    _, answers = wikimedia
    asked = TERRELL.replace(" ", "_")
    answers[photos.COMMONS] = _commons(lambda reply, info: reply["query"].update(normalized=[{"from": asked, "to": TERRELL}]))
    assert asked in photos.licensed([asked]) and TERRELL not in photos.licensed([asked])


def test_licensed_asks_for_fifty_titles_at_a_time(wikimedia):
    calls, answers = wikimedia
    answers[photos.COMMONS] = b'{"query": {"pages": []}}'
    assert photos.licensed([f"File:{i}.jpg" for i in range(120)]) == {}
    assert [len(form["titles"].split("|")) for _, form in calls] == [50, 50, 20]


@pytest.mark.parametrize(("answer", "said"), [
    (b'{"error": {"code": "toomanyvalues", "info": "Too many values supplied"}}', "toomanyvalues"),
    (b'{"continue": {"iistart": "2024-01-01T00:00:00Z"}, "query": {"pages": []}}', "iistart"),
])
def test_licensed_stops_when_commons_does_not_answer_everything(wikimedia, answer, said):
    wikimedia[1][photos.COMMONS] = answer
    with pytest.raises(ValueError, match=said):
        photos.licensed([RAMSEY])


def test_credit_is_one_line_of_plain_text():
    flickr = '<a rel="nofollow" href="https://www.flickr.com/people/10457902@N08">All-Pro Reels</a>\n from District of Columbia, USA'
    assert photos.credit(flickr) == "All-Pro Reels from District of Columbia, USA"
    assert photos.credit("Office of Governor Walz &amp; Lt. Governor Flanagan") == "Office of Governor Walz & Lt. Governor Flanagan"
    assert len(photos.credit("x" * 500)) == 120 and photos.credit("") == ""


def test_collect_writes_the_photos_and_their_credits(tmp_path, wikimedia, capsys):
    dest = tmp_path / "photos"
    dest.mkdir()
    (dest / "999.jpg").write_bytes(b"stale")
    index = photos.collect(PEOPLE, dest)
    assert sorted(index) == ["11", "12", "13", "14"]
    assert index["11"] == {
        "file": "11.jpg", "artist": "Thomson200", "license": "CC0",
        "license_url": "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
        "source": "https://commons.wikimedia.org/wiki/File:Jalen_Ramsey_2014.jpg",
    }
    assert index["13"]["file"] == "13.webp" and index["13"]["source"] == "https://commons.wikimedia.org/wiki/File:PSII2025.webp"
    assert index["14"]["file"] == "14.png" and index["14"]["license_url"] is None
    assert sorted(f.name for f in dest.iterdir()) == ["11.jpg", "12.jpg", "13.webp", "14.png", "photos.json"]
    assert (dest / "14.png").read_bytes() == IMAGE[".png"] and json.loads((dest / "photos.json").read_text()) == index
    lines = capsys.readouterr().out.splitlines()
    assert "photo 11 Jalen Ramsey Q18631600 File:Jalen Ramsey 2014.jpg CC0" in lines
    assert [line for line in lines if line.startswith("no photo")] == [
        "no photo 15 Asante Samuel no image", "no photo 16 Jalen Ramsey no wikidata match",
        "no photo 17 Pete Werner no wikidata match", "no photo 18 No Birthday no wikidata match",
    ]


def test_collect_skips_a_bad_download_and_takes_the_next_free_image(tmp_path, wikimedia, capsys):
    _, answers = wikimedia
    thumbs = {title: pic["thumb"] for title, pic in photos.licensed(TITLES).items()}

    def change(reply, info):
        info[SURTAIN[0]]["extmetadata"]["LicenseShortName"]["value"] = "GFDL"
        info[MOSLEY]["extmetadata"]["LicenseShortName"]["value"] = "GFDL"

    answers[photos.COMMONS] = _commons(change)
    answers[thumbs[RAMSEY]] = urllib.error.HTTPError(thumbs[RAMSEY], 404, "Not Found", None, None)
    answers[thumbs[TERRELL]] = b"<html>not an image</html>"
    index = photos.collect(PEOPLE, tmp_path / "photos")
    assert list(index) == ["13"] and index["13"]["file"] == "13.jpg" and index["13"]["license"] == "CC BY-SA 2.0"
    out = capsys.readouterr().out
    assert "no photo 11 Jalen Ramsey download failed File:Jalen Ramsey 2014.jpg" in out
    assert "no photo 12 A.J. Terrell download failed" in out and "no photo 14 C.J. Mosley no free image" in out


@pytest.mark.parametrize("failure", [
    urllib.error.HTTPError("thumb", 503, "Service Unavailable", None, None),
    urllib.error.HTTPError("thumb", 429, "Too Many Requests", None, None),
    urllib.error.URLError("unreachable"),
])
def test_collect_stops_when_the_downloads_are_refused(tmp_path, wikimedia, failure):
    _, answers = wikimedia
    answers[photos.licensed([RAMSEY])[RAMSEY]["thumb"]] = failure
    with pytest.raises(type(failure)):
        photos.collect(PEOPLE, tmp_path / "photos")
    assert not (tmp_path / "photos" / "photos.json").exists()


def test_collect_leaves_the_last_photos_alone_when_wikidata_is_down(tmp_path, wikimedia):
    _, answers = wikimedia
    answers[photos.SPARQL] = urllib.error.URLError("unreachable")
    dest = tmp_path / "photos"
    dest.mkdir()
    (dest / "11.jpg").write_bytes(b"last run")
    with pytest.raises(urllib.error.URLError):
        photos.collect(PEOPLE, dest)
    assert (dest / "11.jpg").read_bytes() == b"last run"
