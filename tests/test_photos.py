import json
import urllib.error

import polars as pl
import pytest
from conftest import FIXTURES, IMAGE, PEOPLE

from keys import photos
from keys.rate import MIN_PLAYS

RAMSEY, TERRELL, MOSLEY = "File:Jalen Ramsey 2014.jpg", "File:A.J. Terrell.jpg", "File:C.J.Mosley.png"
SURTAIN = ["File:PSII2025.webp", "File:Patrick Surtain 2021 (51650411936) (cropped).jpg", "File:Patrick Surtain II.jpg"]
DIGGS, HAMILTON = "File:Quandre Diggs (50746801588) (cropped).jpg", "File:Kyle Hamilton.png"
TITLES = sorted([RAMSEY, TERRELL, MOSLEY, *SURTAIN, DIGGS, HAMILTON])


def _commons(change) -> bytes:
    """The recorded Commons answer after change(reply, image info by title) has edited it."""
    reply = json.loads((FIXTURES / "commons.json").read_text())
    change(reply, {p["title"]: p["imageinfo"][0] for p in reply["query"]["pages"]})
    return json.dumps(reply).encode()


def test_get_names_the_project_and_posts_a_form(monkeypatch):
    seen = []

    class Reply:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return b"body"

    def urlopen(request, timeout):
        seen.append((request.full_url, request.get_header("User-agent"), request.data, request.get_method(), timeout))
        return Reply()

    monkeypatch.setattr(photos.urllib.request, "urlopen", urlopen)
    assert photos.get("https://example.org/a.jpg") == b"body"
    assert photos.get(photos.SPARQL, {"query": "q", "format": "json"}) == b"body"
    assert seen == [
        ("https://example.org/a.jpg", photos.AGENT, None, "GET", 60),
        (photos.SPARQL, photos.AGENT, b"query=q&format=json", "POST", 60),
    ]
    assert "github.com/Rishi180303/keys" in photos.AGENT


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
        19: {"items": ["Q19877365"], "titles": [DIGGS]},
        20: {"items": ["Q100331972"], "titles": [HAMILTON]},
    }
    [(url, form)] = calls
    dates = sorted({p["born"] for p in PEOPLE if p["born"]})
    assert url == photos.SPARQL and form["format"] == "json" and "None" not in form["query"]
    assert [form["query"].count(f'"{d}T00:00:00Z"') for d in dates] == [1] * 8
    assert "wdt:P106 wd:Q19204627" in form["query"] and 'LANG(?name) IN ("en", "mul")' in form["query"]


def test_match_asks_for_a_hundred_dates_at_a_time(wikimedia, monkeypatch):
    calls, answers = wikimedia
    pauses = []
    monkeypatch.setattr(photos.time, "sleep", pauses.append)
    answers[photos.SPARQL] = b'{"results": {"bindings": []}}'
    people = [{"id": i, "name": "N", "born": f"19{70 + i // 12}-{i % 12 + 1:02d}-01"} for i in range(150)]
    assert photos.match(people) == {}
    assert [form["query"].count("xsd:dateTime") for _, form in calls] == [100, 50]
    assert pauses == [photos.PAUSE]  # one pause, between the two requests


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
    assert sorted(free) == sorted(set(TITLES) - {HAMILTON})  # Commons lists his picture under License review needed
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
    assert form["iiprop"] == "url|thumbmime|extmetadata"
    assert form["iiextmetadatafilter"] == "Artist|Attribution|Categories|LicenseShortName|LicenseUrl"


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
        info[SURTAIN[2]]["extmetadata"]["Categories"]["value"] += "|Deletion requests May 2026"
        next(p for p in reply["query"]["pages"] if p["title"] == DIGGS)["imageinfo"][0]["extmetadata"] = []  # as Commons sends none

    answers[photos.COMMONS] = _commons(change)
    free = photos.licensed(TITLES)
    assert sorted(free) == [MOSLEY] and free[MOSLEY]["license_url"] is None


def test_licensed_credits_the_attribution_the_licensor_asks_for(wikimedia):
    _, answers = wikimedia
    asks = {"value": '<a href="https://example.org">Sterling Dee</a>'}
    answers[photos.COMMONS] = _commons(lambda reply, info: info[RAMSEY]["extmetadata"].update(Attribution=asks))
    free = photos.licensed(TITLES)
    assert free[RAMSEY]["artist"] == "Sterling Dee" and free[DIGGS]["artist"] == "All-Pro Reels"


def test_licensed_answers_under_the_title_it_was_asked(wikimedia):
    _, answers = wikimedia
    asked = TERRELL.replace(" ", "_")
    answers[photos.COMMONS] = _commons(lambda reply, info: reply["query"].update(normalized=[{"from": asked, "to": TERRELL}]))
    assert asked in photos.licensed([asked]) and TERRELL not in photos.licensed([asked])


def test_licensed_asks_for_fifty_titles_at_a_time(wikimedia, monkeypatch):
    calls, answers = wikimedia
    pauses = []
    monkeypatch.setattr(photos.time, "sleep", pauses.append)
    answers[photos.COMMONS] = b'{"query": {"pages": []}}'
    assert photos.licensed([f"File:{i}.jpg" for i in range(120)]) == {}
    assert [len(form["titles"].split("|")) for _, form in calls] == [50, 50, 20] and pauses == [photos.PAUSE] * 2


@pytest.mark.parametrize(("answer", "said"), [
    (b'{"error": {"code": "toomanyvalues", "info": "Too many values supplied"}}', "toomanyvalues"),
    (b'{"continue": {"iicontinue": "File:B.jpg|20240101000000", "continue": "||"}, "query": {"pages": []}}', "iicontinue"),
])
def test_licensed_stops_when_commons_does_not_answer_everything(wikimedia, answer, said):
    wikimedia[1][photos.COMMONS] = answer
    with pytest.raises(ValueError, match=said):
        photos.licensed([RAMSEY])


def test_licensed_takes_a_lone_title_that_has_older_uploads(wikimedia):
    _, answers = wikimedia

    def change(reply, info):
        reply["query"]["pages"] = [p for p in reply["query"]["pages"] if p["title"] == TERRELL]
        reply["continue"] = {"iistart": "2022-06-02T00:30:25Z", "continue": "||"}  # Commons adds this to a whole answer

    answers[photos.COMMONS] = _commons(change)
    assert list(photos.licensed([TERRELL])) == [TERRELL]


def test_credit_is_one_line_of_plain_text():
    flickr = '<a rel="nofollow" href="https://www.flickr.com/people/10457902@N08">All-Pro Reels</a>\n from District of Columbia, USA'
    assert photos.credit(flickr) == "All-Pro Reels from District of Columbia, USA"
    assert photos.credit("Office of Governor Walz &amp; Lt. Governor Flanagan") == "Office of Governor Walz & Lt. Governor Flanagan"
    assert len(photos.credit("x" * 500)) == 120 and photos.credit("") == ""


def test_collect_writes_the_photos_and_their_credits(tmp_path, wikimedia, capsys):
    calls, _ = wikimedia
    dest = tmp_path / "photos"
    dest.mkdir()
    (dest / "999.jpg").write_bytes(b"stale")
    index = photos.collect(PEOPLE, dest)
    assert sorted(index) == ["11", "12", "13", "14", "19"]
    assert [form["titles"] for url, form in calls if url == photos.COMMONS] == ["|".join(TITLES)]  # every matched file
    assert index["11"] == {
        "file": "11.jpg", "artist": "Thomson200", "license": "CC0",
        "license_url": "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
        "source": "https://commons.wikimedia.org/wiki/File:Jalen_Ramsey_2014.jpg",
    }
    assert index["13"]["file"] == "13.webp" and index["13"]["source"] == "https://commons.wikimedia.org/wiki/File:PSII2025.webp"
    assert index["14"]["file"] == "14.png" and index["14"]["license_url"] is None
    assert sorted(f.name for f in dest.iterdir()) == ["11.jpg", "12.jpg", "13.webp", "14.png", "19.jpg", "photos.json"]
    assert (dest / "14.png").read_bytes() == IMAGE[".png"] and json.loads((dest / "photos.json").read_text()) == index
    lines = capsys.readouterr().out.splitlines()
    assert "photo 11 Jalen Ramsey Q18631600 File:Jalen Ramsey 2014.jpg CC0" in lines
    assert [line for line in lines if line.startswith("no photo")] == [
        "no photo 15 Asante Samuel no image", "no photo 16 Jalen Ramsey no wikidata match",
        "no photo 17 Pete Werner no wikidata match", "no photo 18 No Birthday no wikidata match",
        "no photo 20 Kyle Hamilton no free image",
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
    assert list(index) == ["13", "19"] and index["13"]["file"] == "13.jpg" and index["13"]["license"] == "CC BY-SA 2.0"
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
