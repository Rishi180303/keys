import polars as pl

from keys import photos
from keys.rate import MIN_PLAYS


def test_roster_is_the_listed_defenders_with_their_birth_dates():
    rows = [(1, "Listed One", None)] * MIN_PLAYS + [(2, "One Short", None)] * (MIN_PLAYS - 1)
    rows += [(2, "One Short", "out of bounds")] * 5 + [(3, "No Frames", None)] * (MIN_PLAYS + 1)
    table = pl.DataFrame(rows, schema={"nfl_id": pl.Int64, "name": pl.String, "ex": pl.String}, orient="row")
    inp = pl.DataFrame({"nfl_id": [1, 1, 2], "player_birth_date": ["1999-07-12", "1999-07-12", "2000-01-01"]})
    assert photos.roster(table, inp) == [
        {"id": 1, "name": "Listed One", "born": "1999-07-12"}, {"id": 3, "name": "No Frames", "born": None},
    ]
