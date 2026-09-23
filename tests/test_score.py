import pytest
import torch

from keys import score, tensors, train
from keys.features import normalize
from keys.model import KeysNet


def test_each_play_is_scored_by_its_own_fold(synthetic_play, tmp_path, monkeypatch):
    inp, _out = synthetic_play
    plays = tensors.build_plays(normalize(inp), None)
    monkeypatch.setattr(train, "load_plays", lambda weeks: plays)
    monkeypatch.setattr(score, "_targets", lambda weeks, games: None)
    k = train.fold_of(1)
    ckpt = tmp_path / "model.pt"
    torch.save(KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC, d=32, layers=1, heads=2).state_dict(), ckpt)
    monkeypatch.setattr(score, "load_model", lambda path: KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC, d=32, layers=1, heads=2))
    df = score.score({k: ckpt, (k + 1) % 5: ckpt}, [1])
    assert df.height == 12 and df["fold"].unique().to_list() == [k]
    assert set(df.columns) >= {"x_pred", "y_pred", "sd_x", "sd_y", "fold"}


def test_score_raises_when_no_plays_match(synthetic_play, monkeypatch):
    inp, _out = synthetic_play
    plays = tensors.build_plays(normalize(inp), None)
    monkeypatch.setattr(train, "load_plays", lambda weeks: plays)
    monkeypatch.setattr(score, "_targets", lambda weeks, games: None)
    with pytest.raises(ValueError, match="no play matched"):
        score.score({}, [1])
