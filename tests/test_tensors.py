import numpy as np
import torch

from keys import tensors
from keys.features import normalize, normalize_targets


def _plays(synthetic_play):
    inp, out = synthetic_play
    inp = normalize(inp)
    return tensors.build_plays(inp, normalize_targets(out, inp))


def test_shapes_and_masks(synthetic_play):
    (p,) = _plays(synthetic_play)
    assert p["feat"].shape == (3, tensors.T, len(tensors.FEATURES)) and p["static"].shape == (3, tensors.N_STATIC)
    assert p["fmask"].sum(axis=1).tolist() == [12, 12, 12] and not p["fmask"][:, : tensors.T - 12].any()
    assert p["tmask"].sum(axis=1).tolist() == [0, 6, 6]
    assert p["static"][:, tensors.I_PREDICTED].tolist() == [0.0, 1.0, 1.0]


def test_targets_are_displacements_from_last_frame(synthetic_play):
    (p,) = _plays(synthetic_play)
    # receiver (nfl_id 2) moves 0.5 yards in x per frame
    assert np.allclose(p["target"][1, :6, 0], 0.5 * np.arange(1, 7)) and np.allclose(p["target"][1, :6, 1], 0)


def test_receiver_distance_is_zero_for_receiver(synthetic_play):
    (p,) = _plays(synthetic_play)
    i = tensors.FEATURES.index("dist_recv")
    assert np.allclose(p["feat"][1, -1, i], 0.0) and p["feat"][2, -1, i] > 0


def test_collate_pads_and_masks(synthetic_play):
    (p,) = _plays(synthetic_play)
    q = dict(p)
    q["feat"], q["fmask"], q["static"] = p["feat"][:2], p["fmask"][:2], p["static"][:2]
    q["target"], q["tmask"], q["last_xy"] = p["target"][:2], p["tmask"][:2], p["last_xy"][:2]
    b = tensors.collate([p, q])
    assert b["feat"].shape == (2, 3, tensors.T, len(tensors.FEATURES)) and b["feat"].dtype == torch.float32
    assert b["pmask"].tolist() == [[True, True, True], [True, True, False]]
