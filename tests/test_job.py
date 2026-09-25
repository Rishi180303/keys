import json
import runpy
import sys

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
    _rate_setup(roots, monkeypatch, rating_play, supplementary_csv, gate=True)
    _run("rate", monkeypatch)
    ratings = roots / "data" / "ratings"
    assert (ratings / "plays.parquet").exists() and json.loads((ratings / "checks.json").read_text())["passed"]
    meta = json.loads((roots / "data" / "site" / "meta.json").read_text())
    assert meta["api_url"] == "https://api.invalid/predict" and meta["gate"]["passed"] and meta["summary"] is None and meta["run"] == "local"
    game = json.loads((roots / "data" / "site" / "games" / "1.json").read_text())
    assert [p["id"] for p in game["plays"][0]["players"]] == [1, 2, 3, 4]
    assert len(json.loads((roots / "data" / "site" / "plays.json").read_text())["rows"]) == 2


def test_local_rate_refuses_site_data_when_the_gate_fails(roots, monkeypatch, rating_play, supplementary_csv):
    _rate_setup(roots, monkeypatch, rating_play, supplementary_csv, gate=False)
    with pytest.raises(ValueError, match="rating gate failed: cov=X"):
        _run("rate", monkeypatch)
    assert (roots / "data" / "ratings" / "checks.json").exists() and not (roots / "data" / "site").exists()
