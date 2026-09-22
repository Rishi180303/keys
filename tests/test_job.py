import json
import runpy
import sys

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
