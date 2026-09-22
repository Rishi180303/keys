"""Report one fold's model next to the baselines. Usage: uv run python scripts/evaluate.py --fold 0 --weeks 1-18"""

import argparse

import torch

from keys import baselines, data, metric, tensors, train
from keys.model import KeysNet

parser = argparse.ArgumentParser()
parser.add_argument("--weeks", default="1-18")
parser.add_argument("--fold", type=int, default=0)
args = parser.parse_args()

weeks = data.parse_weeks(args.weeks)
plays = [p for p in train.load_plays(weeks) if train.fold_of(p["game_id"]) == args.fold]
games = sorted({p["game_id"] for p in plays})
inp, out = data.load_weeks(weeks, games=games)

results = baselines.baseline_reports(inp, out)
model = KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC)
model.load_state_dict(torch.load(f"models/fold{args.fold}.pt", map_location="cpu"))
dev = train.device()
results["model"] = metric.evaluate_predictions(train.predict(model.to(dev), plays, dev), inp, out)

print(f"fold {args.fold}, {len(games)} games, {len(plays)} plays\n")
print(metric.markdown_table(results))
