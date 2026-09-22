import torch

from keys import tensors
from keys.features import normalize, normalize_targets
from keys.model import KeysNet, gaussian_nll


def _batch(synthetic_play):
    inp, out = synthetic_play
    inp = normalize(inp)
    return tensors.collate(tensors.build_plays(inp, normalize_targets(out, inp)))


def test_forward_shapes_and_finite(synthetic_play):
    b = _batch(synthetic_play)
    model = KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC)
    mean, logvar = model(b["feat"], b["fmask"], b["static"], b["pmask"])
    assert mean.shape == (1, 3, tensors.H, 2) and logvar.shape == mean.shape
    assert torch.isfinite(mean).all() and torch.isfinite(logvar).all()
    loss = gaussian_nll(mean, logvar, b["target"], b["tmask"])
    assert torch.isfinite(loss) and loss.ndim == 0


def test_loss_ignores_masked_frames(synthetic_play):
    b = _batch(synthetic_play)
    mean = torch.zeros_like(b["target"])
    logvar = torch.zeros_like(b["target"])
    base = gaussian_nll(mean, logvar, b["target"], b["tmask"])
    noisy = b["target"].clone()
    noisy[~b["tmask"]] = 1e6
    assert torch.allclose(base, gaussian_nll(mean, logvar, noisy, b["tmask"]))


def test_model_overfits_one_batch(synthetic_play):
    torch.manual_seed(0)
    b = _batch(synthetic_play)
    model = KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC, d=32, layers=1, heads=2)
    opt = torch.optim.Adam(model.parameters(), lr=1e-2)

    def step():
        mean, logvar = model(b["feat"], b["fmask"], b["static"], b["pmask"])
        loss = gaussian_nll(mean, logvar, b["target"], b["tmask"])
        opt.zero_grad()
        loss.backward()
        opt.step()
        return loss.item()

    first = step()
    for _ in range(100):
        last = step()
    assert last < first
