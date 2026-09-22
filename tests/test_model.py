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


def test_padded_slots_do_not_change_real_players(synthetic_play):
    b = _batch(synthetic_play)
    p = b["plays"][0]
    q = {"feat": p["feat"][:2], "fmask": p["fmask"][:2], "static": p["static"][:2], "target": p["target"][:2], "tmask": p["tmask"][:2], "last_xy": p["last_xy"][:2]}
    for k in ("game_id", "play_id", "nfl_id", "is_left", "nfo"):
        if k in p:
            q[k] = p[k]
    torch.manual_seed(0)
    model = KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC, d=32, layers=1, heads=2)
    model.eval()
    batched = tensors.collate([p, q])
    alone = tensors.collate([q])
    with torch.no_grad():
        mean_batched, logvar_batched = model(batched["feat"], batched["fmask"], batched["static"], batched["pmask"])
        mean_alone, logvar_alone = model(alone["feat"], alone["fmask"], alone["static"], alone["pmask"])
    assert torch.isfinite(mean_batched).all() and torch.isfinite(logvar_batched).all()
    assert torch.isfinite(mean_alone).all() and torch.isfinite(logvar_alone).all()
    assert batched["pmask"].tolist() == [[True, True, True], [True, True, False]]
    assert torch.allclose(mean_batched[1, :2], mean_alone[0], atol=1e-5)
    assert torch.allclose(logvar_batched[1, :2], logvar_alone[0], atol=1e-5)
