from pathlib import Path

from keys import paths


def test_roots_follow_environment(roots):
    assert paths.DATA == roots / "data" and paths.MODELS == roots / "models"


def test_roots_default_to_relative_paths():
    assert paths.DATA == Path("data") and paths.MODELS == Path("models")
    assert paths.RAW == Path("nfl-big-data-bowl-2026-prediction/train")


def test_supplementary_path_default_and_override(monkeypatch):
    assert paths.SUPPLEMENTARY == Path("114239_nfl_competition_files_published_analytics_final/supplementary_data.csv")
    monkeypatch.setenv("KEYS_SUPPLEMENTARY", "/work/raw/supplementary_data.csv")
    import importlib

    importlib.reload(paths)
    assert paths.SUPPLEMENTARY == Path("/work/raw/supplementary_data.csv")
    monkeypatch.undo()
    importlib.reload(paths)
