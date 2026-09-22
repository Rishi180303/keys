"""Game grouped folds, training loop, prediction in field coordinates."""

import json
import math
import os
import pickle
import random
import zlib
from pathlib import Path

import numpy as np
import polars as pl
import torch
from torch.utils.data import DataLoader

from keys import data, features, metric, tensors
from keys.model import KeysNet, gaussian_nll
from keys.paths import DATA, MODELS

N_FOLDS = 5
META_COLUMNS = data.KEY + ["player_role", "num_frames_output"]


def fold_of(game_id: int) -> int:
    """Stable assignment that does not follow the calendar."""
    return zlib.crc32(str(game_id).encode()) % N_FOLDS


def device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def ema_avg(avg, cur, n):
    """EMA with warm-up: decay grows from 0.1 toward 0.999 as updates n accumulate."""
    decay = torch.clamp((1 + n) / (10 + n), max=0.999)
    return avg + (cur - avg) * (1 - decay)


def load_plays(weeks) -> list[dict]:
    """Build play tensors per week, cached as pickle under data/tensors."""
    cache = DATA / "tensors"
    cache.mkdir(parents=True, exist_ok=True)
    plays = []
    for w in weeks:
        f = cache / f"w{w:02d}_{zlib.crc32(repr((tensors.T, tensors.H, tensors.FEATURES, tensors.N_STATIC)).encode()):08x}.pkl"
        if not f.exists():
            inp, out = data.load_week(w)
            inp = features.normalize(inp)
            f.write_bytes(pickle.dumps(tensors.build_plays(inp, features.normalize_targets(out, inp))))
        plays += pickle.loads(f.read_bytes())
    return plays


def mirror(batch: dict) -> dict:
    """Flip the field across its long axis in place: every y component and the y target change sign."""
    batch["feat"][..., tensors.MIRROR] *= -1
    batch["target"][..., 1] *= -1
    return batch


def predict(model, plays: list[dict], dev: torch.device, batch_size: int = 64) -> pl.DataFrame:
    """Absolute predictions in original field coordinates, one row per predicted player and frame."""
    model.eval()
    rows = []
    with torch.no_grad():
        for i in range(0, len(plays), batch_size):
            b = tensors.collate(plays[i : i + batch_size])
            mean, logvar = model(b["feat"].to(dev), b["fmask"].to(dev), b["static"].to(dev), b["pmask"].to(dev))
            mean = mean.cpu().numpy()
            sd = torch.exp(0.5 * logvar).cpu().numpy()
            for j, p in enumerate(b["plays"]):
                for s in np.flatnonzero(p["static"][:, tensors.I_PREDICTED]):
                    for k in range(1, p["nfo"] + 1):
                        d = mean[j, s, min(k, tensors.H) - 1]  # past the horizon, hold the last prediction
                        x, y = p["last_xy"][s] + d
                        rows.append((p["game_id"], p["play_id"], int(p["nfl_id"][s]), k, float(x), float(y), float(sd[j, s, min(k, tensors.H) - 1, 0]), float(sd[j, s, min(k, tensors.H) - 1, 1]), p["is_left"]))
    df = pl.DataFrame(rows, schema=data.KEY + ["frame_id", "x_pred", "y_pred", "sd_x", "sd_y", "is_left"], orient="row")
    df = df.with_columns(play_direction=pl.when(pl.col("is_left")).then(pl.lit("left")).otherwise(pl.lit("right")))
    return features.denormalize(df).drop("is_left", "play_direction")


def train(weeks, fold: int, epochs: int = 30, batch_size: int = 64, lr: float = 1e-3, run_name: str | None = None) -> dict:
    import mlflow

    plays = load_plays(weeks)
    tr = [p for p in plays if fold_of(p["game_id"]) != fold]
    va = [p for p in plays if fold_of(p["game_id"]) == fold]
    inp_va, out_va = data.load_weeks(weeks, columns=META_COLUMNS, games=sorted({p["game_id"] for p in va}))
    dev = device()
    model = KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC).to(dev)
    ema = torch.optim.swa_utils.AveragedModel(model, avg_fn=ema_avg)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-2)
    steps = epochs * math.ceil(len(tr) / batch_size)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=steps, pct_start=0.1)
    loader = DataLoader(tr, batch_size=batch_size, shuffle=True, collate_fn=tensors.collate)
    best, best_state, best_rep, bad_epochs, rep = float("inf"), None, {}, 0, {}

    uri = os.environ.get("MLFLOW_TRACKING_URI", "sqlite:///mlruns/mlflow.db")
    if uri.startswith("sqlite:///mlruns"):
        Path("mlruns").mkdir(exist_ok=True)
    mlflow.set_tracking_uri(uri)
    mlflow.set_experiment("keys-phase1")
    with mlflow.start_run(run_name=run_name):
        mlflow.log_params({"fold": fold, "weeks": f"{weeks[0]}-{weeks[-1]}", "epochs": epochs, "batch_size": batch_size, "lr": lr,
                           "n_train": len(tr), "n_val": len(va), "params": sum(p.numel() for p in model.parameters())})
        for epoch in range(epochs):
            model.train()
            total = 0.0
            for b in loader:
                if random.random() < 0.5:
                    mirror(b)
                mean, logvar = model(b["feat"].to(dev), b["fmask"].to(dev), b["static"].to(dev), b["pmask"].to(dev))
                loss = gaussian_nll(mean, logvar, b["target"].to(dev), b["tmask"].to(dev))
                if not torch.isfinite(loss):
                    raise RuntimeError(f"non finite loss on plays {[(p['game_id'], p['play_id']) for p in b['plays']]}")
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                sched.step()
                ema.update_parameters(model)
                total += loss.item() * len(b["plays"])
            rep = metric.evaluate_predictions(predict(ema.module, va, dev), inp_va, out_va)
            mlflow.log_metrics({"train_loss": total / len(tr), **{"val_" + k: v for k, v in rep.items()}}, step=epoch)
            print(f"epoch {epoch} loss {total / len(tr):.4f} val_all {rep['all']:.4f} val_le40 {rep['le40']:.4f}")
            if rep["le40"] < best:
                best, bad_epochs = rep["le40"], 0
                best_state = {k: v.detach().cpu().clone() for k, v in ema.module.state_dict().items()}
                best_rep = rep
            else:
                bad_epochs += 1
            if bad_epochs >= 5:
                break
        MODELS.mkdir(parents=True, exist_ok=True)
        torch.save(best_state, MODELS / f"fold{fold}.pt")
        (MODELS / f"fold{fold}.json").write_text(json.dumps(best_rep))
        mlflow.log_artifact(str(MODELS / f"fold{fold}.pt"))
        mlflow.log_metric("best_le40", best)
    return best_rep
