"""Free licensed player photos: find each listed defender on Wikidata by name and birth date, keep the images
Wikimedia Commons offers under a free license, and write the thumbnails with their credits."""

import polars as pl

from keys.rate import MIN_PLAYS


def roster(table: pl.DataFrame, inp: pl.DataFrame) -> list[dict]:
    """The listed defenders, the ones with at least MIN_PLAYS rated plays, as {"id", "name", "born"} ordered by id.

    table is the rated play table and inp any input frames that hold nfl_id and player_birth_date."""
    rated = table.filter(pl.col("ex").is_null())
    listed = rated.group_by("nfl_id").agg(pl.len().alias("n"), pl.col("name").last()).filter(pl.col("n") >= MIN_PLAYS)
    born = inp.group_by("nfl_id").agg(pl.col("player_birth_date").min().alias("born"))
    people = listed.join(born, on="nfl_id", how="left").sort("nfl_id")
    return people.select(pl.col("nfl_id").alias("id"), "name", "born").to_dicts()
