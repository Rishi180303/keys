"""Cross fitted predictions: every play is scored by the fold model that never trained on it."""

from pathlib import Path

import polars as pl
import torch

from keys import data, metric, tensors, train
from keys.model import KeysNet


def load_model(path: Path) -> KeysNet:
    """A KeysNet with the default sizes and the weights of one checkpoint, on the CPU."""
    model = KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC)
    model.load_state_dict(torch.load(path, map_location="cpu"))
    return model


def _targets(weeks, games):
    """Input meta and output frames for these games, or None when the parquet is not there."""
    try:
        return data.load_weeks(weeks, columns=train.META_COLUMNS, games=games)
    except FileNotFoundError:
        return None


def score(checkpoints: dict[int, Path], weeks) -> pl.DataFrame:
    plays = train.load_plays(weeks)
    dev = train.device()
    frames = []
    for fold, path in sorted(checkpoints.items()):
        mine = [p for p in plays if train.fold_of(p["game_id"]) == fold]
        if not mine:
            continue
        pred = train.predict(load_model(path).to(dev), mine, dev).with_columns(fold=pl.lit(fold, dtype=pl.Int64))
        games = sorted({p["game_id"] for p in mine})
        targets = _targets(weeks, games)
        if targets is not None:
            rep = metric.evaluate_predictions(pred, *targets)
            print(f"fold {fold}: {len(mine)} plays, le40 {rep['le40']:.4f}, all {rep['all']:.4f}")
        frames.append(pred)
    if not frames:
        raise ValueError("no play matched any checkpoint fold")
    return pl.concat(frames)
