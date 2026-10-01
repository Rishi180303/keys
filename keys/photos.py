"""Free licensed player photos: find each listed defender on Wikidata by name and birth date, keep the images
Wikimedia Commons offers under a free license, and write the thumbnails with their credits."""

import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request

import polars as pl

from keys.rate import MIN_PLAYS

SPARQL = "https://query.wikidata.org/sparql"
AGENT = "keys-photos/1.0 (https://github.com/Rishi180303/keys)"
PAUSE = 0.5  # seconds between requests
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def get(url: str, form: dict | None = None) -> bytes:
    """GET url, or POST form, naming this project in the User-Agent the way Wikimedia asks."""
    body = urllib.parse.urlencode(form).encode() if form else None
    request = urllib.request.Request(url, data=body, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=60) as reply:
        return reply.read()


def roster(table: pl.DataFrame, inp: pl.DataFrame) -> list[dict]:
    """The listed defenders, the ones with at least MIN_PLAYS rated plays, as {"id", "name", "born"} ordered by id.

    table is the rated play table and inp any input frames that hold nfl_id and player_birth_date."""
    rated = table.filter(pl.col("ex").is_null())
    listed = rated.group_by("nfl_id").agg(pl.len().alias("n"), pl.col("name").last()).filter(pl.col("n") >= MIN_PLAYS)
    born = inp.group_by("nfl_id").agg(pl.col("player_birth_date").min().alias("born"))
    people = listed.join(born, on="nfl_id", how="left").sort("nfl_id")
    return people.select(pl.col("nfl_id").alias("id"), "name", "born").to_dicts()


def plain(name: str) -> str:
    """A name without case, accents, punctuation, spaces or a generational suffix: A.J. Terrell equals A. J. Terrell."""
    words = re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFKD", name).lower()).split()
    while len(words) > 1 and words[-1] in SUFFIXES:
        words.pop()
    return "".join(words)


def query(dates: list[str]) -> str:
    """SPARQL for every American football player born on one of the dates, with each English name and each image."""
    values = " ".join(f'"{d}T00:00:00Z"^^xsd:dateTime' for d in dates)
    return (
        f"SELECT ?born ?item ?name ?image WHERE {{ VALUES ?born {{ {values} }} "
        "?item wdt:P569 ?born ; wdt:P106 wd:Q19204627 ; rdfs:label|skos:altLabel ?name . "
        'FILTER(LANG(?name) = "en") OPTIONAL { ?item wdt:P18 ?image } }'
    )


def match(people: list[dict]) -> dict[int, dict]:
    """Each player's Wikidata items and Commons file titles, as id -> {"items", "titles"}.

    A player matches the American football player born on his birth date whose English label or alias is his
    name, compared with plain(); a name plain() empties matches nobody. Players nobody matches are left out,
    and a match without an image has no titles."""
    dates = sorted({p["born"] for p in people if DATE.fullmatch(p["born"] or "")})
    born: dict[str, dict[str, dict]] = {}
    for i in range(0, len(dates), 100):
        if i:
            time.sleep(PAUSE)
        reply = json.loads(get(SPARQL, {"query": query(dates[i : i + 100]), "format": "json"}))
        for b in reply["results"]["bindings"]:
            item = b["item"]["value"].rsplit("/", 1)[1]
            person = born.setdefault(b["born"]["value"][:10], {}).setdefault(item, {"names": set(), "titles": set()})
            person["names"].add(plain(b["name"]["value"]))
            if "image" in b:
                person["titles"].add("File:" + urllib.parse.unquote(b["image"]["value"].rsplit("/", 1)[1]))
    found = {}
    for p in people:
        name = plain(p["name"] or "")
        items = {q: v for q, v in born.get(p["born"], {}).items() if name and name in v["names"]}
        if items:
            found[p["id"]] = {"items": sorted(items), "titles": sorted({t for v in items.values() for t in v["titles"]})}
    return found
