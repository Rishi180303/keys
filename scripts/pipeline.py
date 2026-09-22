"""Drive the cloud pipeline from the Mac. Usage:
  uv run python scripts/pipeline.py upload
  uv run python scripts/pipeline.py start [--weeks 1-18] [--epochs 80]
  uv run python scripts/pipeline.py status --execution <arn>"""

import argparse
import json
import time
from pathlib import Path

import boto3

from keys import paths, sync

ACCOUNT = boto3.client("sts").get_caller_identity()["Account"]
DATA_BUCKET = f"keys-data-{ACCOUNT}"
REGION = "us-east-1"
MACHINE = f"arn:aws:states:{REGION}:{ACCOUNT}:stateMachine:keys-pipeline"

parser = argparse.ArgumentParser()
parser.add_argument("command", choices=["upload", "start", "status"])
parser.add_argument("--weeks", default="1-18")
parser.add_argument("--epochs", type=int, default=80)
parser.add_argument("--execution")
args = parser.parse_args()

if args.command == "upload":
    keys = sync.push(paths.RAW, DATA_BUCKET, "raw/")
    keys += sync.push(Path("114239_nfl_competition_files_published_analytics_final/supplementary_data.csv"), DATA_BUCKET, "raw/")
    print("uploaded", len(keys), "files")
elif args.command == "start":
    run = time.strftime("%Y-%m-%dT%H-%M")
    payload = {"run": run, "weeks": args.weeks, "epochs": args.epochs, "folds": [0, 1, 2, 3, 4]}
    arn = boto3.client("stepfunctions").start_execution(stateMachineArn=MACHINE, name=run, input=json.dumps(payload))["executionArn"]
    print("started", run, arn)
else:
    d = boto3.client("stepfunctions").describe_execution(executionArn=args.execution)
    print(d["status"], d.get("stopDate", ""), d.get("cause", ""))
