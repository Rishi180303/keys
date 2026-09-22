import polars as pl
import torch

from keys import tensors
from keys.features import normalize, normalize_targets
from keys.metric import evaluate_predictions
from keys.model import KeysNet
from keys.train import N_FOLDS, ema_avg, fold_of, mirror, predict


class ZeroDisplacement(torch.nn.Module):
    """Predicts no movement at all: mean and logvar both zero."""

    def forward(self, feat, fmask, static, pmask):
        shape = (*pmask.shape, tensors.H, 2)
        return torch.zeros(shape), torch.zeros(shape)


def test_fold_is_stable_and_balanced():
    folds = [fold_of(g) for g in range(2023090700, 2023090700 + 1000)]
    assert fold_of(2023090700) == fold_of(2023090700)
    assert all(0 <= f < N_FOLDS for f in folds)
    assert all(150 <= folds.count(f) <= 250 for f in range(N_FOLDS))


def test_mirror_negates_y_components(synthetic_play):
    inp, out = synthetic_play
    inp = normalize(inp)
    b = tensors.collate(tensors.build_plays(inp, normalize_targets(out, inp)))
    before_feat, before_target = b["feat"].clone(), b["target"].clone()
    mirror(b)
    assert torch.equal(b["feat"][..., tensors.MIRROR], -before_feat[..., tensors.MIRROR])
    assert torch.equal(b["target"][..., 1], -before_target[..., 1])
    assert torch.equal(b["feat"][..., 0], before_feat[..., 0])


def test_predict_covers_every_target_row(synthetic_play):
    inp, out = synthetic_play
    plays = tensors.build_plays(normalize(inp), None)
    model = KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC, d=32, layers=1, heads=2)
    pred = predict(model, plays, torch.device("cpu"))
    assert pred.height == 12 and pred["frame_id"].max() == 6
    report = evaluate_predictions(pred, inp, out)
    assert "all" in report


def test_predict_on_left_play(synthetic_play):
    """A zero displacement model's prediction, denormalized, must land back on the raw last input position."""
    inp, _ = synthetic_play
    inp = inp.with_columns(play_direction=pl.lit("left"))
    plays = tensors.build_plays(normalize(inp), None)
    assert plays[0]["is_left"]
    pred = predict(ZeroDisplacement(), plays, torch.device("cpu"))
    last = inp.sort("frame_id").group_by("nfl_id").last().select("nfl_id", "x", "y")
    chk = pred.filter(pl.col("frame_id") == 1).join(last, on="nfl_id")
    assert chk.height == 2
    assert (chk["x_pred"] - chk["x"]).abs().max() < 1e-4
    assert (chk["y_pred"] - chk["y"]).abs().max() < 1e-4


def test_ema_warmup_schedule():
    avg, cur = torch.zeros(3), torch.ones(3)
    early = ema_avg(avg, cur, torch.tensor(0))
    late = ema_avg(avg, cur, torch.tensor(100000))
    assert torch.allclose(early, torch.full((3,), 0.9))
    assert torch.allclose(late, torch.full((3,), 0.001), atol=1e-6)


def test_predict_reports_spread(synthetic_play):
    inp, _ = synthetic_play
    plays = tensors.build_plays(normalize(inp), None)
    pred = predict(ZeroDisplacement(), plays, torch.device("cpu"))
    assert pred["sd_x"].to_list() == [1.0] * 12 and pred["sd_y"].to_list() == [1.0] * 12
