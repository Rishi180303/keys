"""Train one fold. Usage: uv run python scripts/train.py --weeks 1-18 --fold 0 --epochs 80
View runs: uv run mlflow ui --backend-store-uri sqlite:///mlruns/mlflow.db"""

import argparse

from keys.data import parse_weeks
from keys.train import train

parser = argparse.ArgumentParser()
parser.add_argument("--weeks", default="1-18")
parser.add_argument("--fold", type=int, default=0)
parser.add_argument("--epochs", type=int, default=80)
parser.add_argument("--batch-size", type=int, default=64)
parser.add_argument("--lr", type=float, default=1e-3)
parser.add_argument("--run-name")
args = parser.parse_args()
print(train(parse_weeks(args.weeks), args.fold, args.epochs, args.batch_size, args.lr, args.run_name))
