import io
import json
import runpy
import sys
import urllib.error

import polars as pl
import pytest
import torch

from keys import tensors
from keys.model import KeysNet


def _run(stage, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["job.py", stage])
    runpy.run_path("scripts/job.py", run_name="__main__")


def test_local_score_and_publish(roots, monkeypatch, synthetic_play):
    from keys import score, train
    from keys.features import normalize

    inp, _ = synthetic_play
    plays = tensors.build_plays(normalize(inp), None)
    monkeypatch.setattr(train, "load_plays", lambda weeks: plays)
    monkeypatch.setattr(score, "_targets", lambda weeks, games: None)
    monkeypatch.setenv("KEYS_WEEKS", "1")
    models = roots / "models"
    for k in range(5):
        (models / "local" / f"fold{k}").mkdir(parents=True)
        torch.save(KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC).state_dict(), models / "local" / f"fold{k}" / "model.pt")
        (models / "local" / f"fold{k}" / "report.json").write_text(json.dumps({"le40": 0.5 + k / 10}))
    _run("score", monkeypatch)
    assert (roots / "data" / "predictions" / "predictions.parquet").exists()
    _run("publish", monkeypatch)
    summary = json.loads((models / "summary.json").read_text())
    assert summary["le40"]["folds"] == 5 and abs(summary["le40"]["mean"] - 0.7) < 1e-9


def test_publish_no_reports(roots, monkeypatch):
    monkeypatch.setenv("KEYS_WEEKS", "1")
    (roots / "models" / "local").mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="no report.json"):
        _run("publish", monkeypatch)


def _rate_setup(roots, monkeypatch, rating_play, supplementary_csv, gate):
    from conftest import reload_roots

    from keys import data, rate

    inp, out, pred, _sup = rating_play
    monkeypatch.setenv("KEYS_SUPPLEMENTARY", str(supplementary_csv))
    monkeypatch.setenv("KEYS_WEEKS", "1")
    monkeypatch.setenv("KEYS_API_URL", "https://api.invalid/predict")
    reload_roots()
    data.PROCESSED.mkdir(parents=True)
    inp.write_parquet(data.PROCESSED / "input_w01.parquet")
    out.write_parquet(data.PROCESSED / "output_w01.parquet")
    (roots / "data" / "predictions").mkdir()
    pred.write_parquet(roots / "data" / "predictions" / "predictions.parquet")
    checks = {"passed": gate, "failed": [] if gate else ["cov=X mean +0.900"], "rows": {"flagged": 2}, "reliability": None, "league_mean": None, "excluded": None}
    monkeypatch.setattr(rate, "gate", lambda table, players: checks)


def test_local_rate_writes_ratings_and_site(roots, monkeypatch, rating_play, supplementary_csv):
    from keys import site

    _rate_setup(roots, monkeypatch, rating_play, supplementary_csv, gate=True)
    monkeypatch.setattr(site, "MIN_PLAYS", 1)  # so the one play season has a listed defender and a highlight
    monkeypatch.setattr(site, "HIGHLIGHT_AIR", 6)
    _run("rate", monkeypatch)
    ratings = roots / "data" / "ratings"
    assert (ratings / "plays.parquet").exists() and json.loads((ratings / "checks.json").read_text())["passed"]
    meta = json.loads((roots / "data" / "site" / "meta.json").read_text())
    assert meta["api_url"] == "https://api.invalid/predict" and meta["gate"]["passed"] and meta["summary"] is None and meta["run"] == "local"
    game = json.loads((roots / "data" / "site" / "games" / "1.json").read_text())
    assert [p["id"] for p in game["plays"][0]["players"]] == [1, 2, 3, 4]
    assert len(json.loads((roots / "data" / "site" / "plays.json").read_text())["rows"]) == 2
    reel = json.loads((roots / "data" / "site" / "highlights.json").read_text())
    assert [(h["id"], h["scene"]["play"]) for h in reel] == [(3, 1)] and reel[0]["scene"]["players"][0]["in"][0] == [40.0, 25.0]


def test_local_rate_refuses_site_data_when_the_gate_fails(roots, monkeypatch, rating_play, supplementary_csv):
    _rate_setup(roots, monkeypatch, rating_play, supplementary_csv, gate=False)
    with pytest.raises(ValueError, match="rating gate failed: cov=X"):
        _run("rate", monkeypatch)
    assert (roots / "data" / "ratings" / "checks.json").exists() and not (roots / "data" / "site").exists()


def test_rate_refuses_a_site_bucket_without_an_api_url(roots, monkeypatch, rating_play, supplementary_csv):
    _rate_setup(roots, monkeypatch, rating_play, supplementary_csv, gate=True)
    monkeypatch.delenv("KEYS_API_URL")
    monkeypatch.setenv("KEYS_SITE_BUCKET", "site")
    with pytest.raises(ValueError, match="KEYS_API_URL"):
        _run("rate", monkeypatch)
    assert not (roots / "data" / "ratings").exists()


def test_rate_with_buckets_pulls_and_pushes(roots, monkeypatch, rating_play, supplementary_csv, fake_s3):
    from conftest import reload_roots

    from keys import rate, sync

    inp, out, pred, _sup = rating_play
    monkeypatch.setenv("KEYS_RAW", str(roots / "raw"))
    monkeypatch.setenv("KEYS_WEEKS", "1")
    monkeypatch.setenv("KEYS_RUN", "run1")
    monkeypatch.setenv("KEYS_API_URL", "https://api.invalid/predict")
    monkeypatch.setenv("KEYS_DATA_BUCKET", "data")
    monkeypatch.setenv("KEYS_ARTIFACTS_BUCKET", "art")
    monkeypatch.setenv("KEYS_SITE_BUCKET", "site")
    reload_roots()
    for name, frame in (("input_w01.parquet", inp), ("output_w01.parquet", out)):
        frame.write_parquet(roots / name)
        fake_s3.store[("data", "processed/" + name)] = (roots / name).read_bytes()
    fake_s3.store[("data", "raw/supplementary_data.csv")] = supplementary_csv.read_bytes()
    pred.write_parquet(roots / "pred.parquet")
    fake_s3.store[("art", "predictions/run1/predictions.parquet")] = (roots / "pred.parquet").read_bytes()
    fake_s3.store[("art", "summary/run1.json")] = b'{"le40": {"mean": 0.5}}'
    photos = {("site", "data/photos.json"): b'{"11":{"file":"11.jpg"}}', ("site", "data/photos/11.jpg"): b"jpeg"}
    fake_s3.store.update(photos)  # what the photos step published earlier
    monkeypatch.setattr(sync, "client", lambda: fake_s3)
    checks = {"passed": True, "failed": [], "rows": {"flagged": 2}, "reliability": None, "league_mean": None, "excluded": None}
    monkeypatch.setattr(rate, "gate", lambda table, players: checks)
    _run("rate", monkeypatch)
    keys = {k for (b, k) in fake_s3.store if b in ("art", "site")}
    assert {"ratings/run1/plays.parquet", "ratings/run1/checks.json", "data/plays.json", "data/meta.json", "data/games/1.json"} <= keys
    assert fake_s3.extra[("site", "data/meta.json")] == {"CacheControl": "max-age=300", "ContentType": "application/json"}
    assert fake_s3.store[("site", "data/highlights.json")] == b"[]"
    assert {k: fake_s3.store[k] for k in photos} == photos and not set(photos) & set(fake_s3.extra)  # a rerun leaves them alone
    assert fake_s3.extra[("site", "data/highlights.json")] == fake_s3.extra[("site", "data/meta.json")]
    assert fake_s3.extra[("art", "ratings/run1/checks.json")] is None
    assert json.loads(fake_s3.store[("site", "data/meta.json")])["summary"] == {"le40": {"mean": 0.5}}
    assert (roots / "raw" / "supplementary_data.csv").exists()


def _photos_inputs(people):
    """What the photos stage reads, as bytes by path: a rated table that lists people and one week with birth dates."""
    from keys.rate import MIN_PLAYS

    def parquet(frame):
        buffer = io.BytesIO()
        frame.write_parquet(buffer)
        return buffer.getvalue()

    listed = [p for p in people for _ in range(MIN_PLAYS)]
    table = pl.DataFrame({"nfl_id": [p["id"] for p in listed], "name": [p["name"] for p in listed]})
    born = pl.DataFrame({"nfl_id": [p["id"] for p in people], "player_birth_date": [p["born"] for p in people]})
    return {
        "ratings/plays.parquet": parquet(table.with_columns(ex=pl.lit(None, dtype=pl.String))),
        "processed/input_w01.parquet": parquet(born), "processed/output_w01.parquet": parquet(born.select("nfl_id")),
    }


def _photos_local(roots, monkeypatch):
    from conftest import PEOPLE

    monkeypatch.setenv("KEYS_WEEKS", "1")
    for rel, body in _photos_inputs(PEOPLE).items():
        (roots / "data" / rel).parent.mkdir(parents=True, exist_ok=True)
        (roots / "data" / rel).write_bytes(body)


def test_local_photos_writes_the_photos_and_their_index(roots, monkeypatch, wikimedia):
    _photos_local(roots, monkeypatch)
    monkeypatch.setenv("KEYS_PHOTOS_EXCLUDE", "12, 14")
    _run("photos", monkeypatch)
    dest = roots / "data" / "photos"
    assert sorted(f.name for f in dest.iterdir()) == ["11.jpg", "13.webp", "photos.json"]
    assert sorted(json.loads((dest / "photos.json").read_text())) == ["11", "13"]


def test_photos_with_buckets_pulls_and_pushes(roots, monkeypatch, wikimedia, fake_s3):
    from conftest import PEOPLE

    from keys import sync

    monkeypatch.setenv("KEYS_WEEKS", "1")
    monkeypatch.setenv("KEYS_RUN", "run1")
    monkeypatch.setenv("KEYS_DATA_BUCKET", "data")
    monkeypatch.setenv("KEYS_ARTIFACTS_BUCKET", "art")
    monkeypatch.setenv("KEYS_SITE_BUCKET", "site")
    files = _photos_inputs(PEOPLE)
    fake_s3.store[("art", "ratings/run1/plays.parquet")] = files.pop("ratings/plays.parquet")
    for rel, body in files.items():
        fake_s3.store[("data", rel)] = body
    monkeypatch.setattr(sync, "client", lambda: fake_s3)
    _run("photos", monkeypatch)
    pushed = [k for (b, k) in fake_s3.store if b == "site"]
    assert pushed == ["data/photos/11.jpg", "data/photos/12.jpg", "data/photos/13.webp", "data/photos/14.png", "data/photos.json"]
    assert fake_s3.extra[("site", "data/photos/11.jpg")] == {"CacheControl": "max-age=86400", "ContentType": "image/jpeg"}
    assert fake_s3.extra[("site", "data/photos/13.webp")] == {"CacheControl": "max-age=86400", "ContentType": "image/webp"}
    assert fake_s3.extra[("site", "data/photos/14.png")] == {"CacheControl": "max-age=86400", "ContentType": "image/png"}
    assert fake_s3.extra[("site", "data/photos.json")] == {"CacheControl": "max-age=300", "ContentType": "application/json"}
    assert sorted(json.loads(fake_s3.store[("site", "data/photos.json")])) == ["11", "12", "13", "14"]


@pytest.mark.parametrize(("answer", "error"), [
    (b'{"results": {"bindings": []}}', ValueError),
    (urllib.error.URLError("unreachable"), urllib.error.URLError),
])
def test_photos_publishes_nothing_when_it_finds_nothing(roots, monkeypatch, wikimedia, fake_s3, answer, error):
    from keys import photos, sync

    _photos_local(roots, monkeypatch)
    monkeypatch.setenv("KEYS_SITE_BUCKET", "site")
    monkeypatch.setattr(sync, "client", lambda: fake_s3)
    wikimedia[1][photos.SPARQL] = answer
    with pytest.raises(error):
        _run("photos", monkeypatch)
    assert not fake_s3.store
