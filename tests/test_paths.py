from pathlib import Path

from keys import paths


def test_roots_follow_environment(roots):
    assert paths.DATA == roots / "data" and paths.MODELS == roots / "models"


def test_roots_default_to_relative_paths():
    assert paths.DATA == Path("data") and paths.MODELS == Path("models")
    assert paths.RAW == Path("nfl-big-data-bowl-2026-prediction/train")
