"""Check a running prediction api against the pipeline. Usage:
  uv run python scripts/check_api.py <url>              the deployed api, url from terraform output api_url
  uv run python scripts/check_api.py <url> --emulator   a serve container under the lambda runtime emulator

Sends the first week 1 play whose game is in fold 0, so the fold 0 model the api serves never trained on it,
compares the answer with that run's predictions.parquet, then sends one bad request."""

import argparse
import io
import json
import sys
import urllib.error
import urllib.request

import boto3
import polars as pl

from keys import data, train

ACCOUNT = boto3.client("sts").get_caller_identity()["Account"]
ARTIFACTS = f"keys-artifacts-{ACCOUNT}"

parser = argparse.ArgumentParser()
parser.add_argument("url")
parser.add_argument("--emulator", action="store_true")
args = parser.parse_args()


def post(rows: list[dict]) -> tuple[int, dict]:
    """Send rows the way a client would. The emulator wants the api gateway event and answers with the reply."""
    body = json.dumps({"rows": rows})
    if args.emulator:
        body = json.dumps({"body": body, "isBase64Encoded": False})
    req = urllib.request.Request(args.url, body.encode(), {"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, text = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read()
    reply = json.loads(text)
    if args.emulator:
        return reply["statusCode"], json.loads(reply["body"])
    return status, reply


inp, _ = data.load_weeks([1])
game = min(g for g in inp["game_id"].unique() if train.fold_of(g) == 0)
play_id = inp.filter(pl.col("game_id") == game)["play_id"].min()
play = inp.filter((pl.col("game_id") == game) & (pl.col("play_id") == play_id))

status, reply = post(json.loads(play.write_json()))
if status != 200:
    sys.exit(f"good request answered {status}: {reply}")
run = reply["model"].split("/")[1]
obj = boto3.client("s3").get_object(Bucket=ARTIFACTS, Key=f"predictions/{run}/predictions.parquet")
ref = pl.read_parquet(io.BytesIO(obj["Body"].read()))
ref = ref.filter((pl.col("game_id") == game) & (pl.col("play_id") == play_id))
got = pl.DataFrame(reply["predictions"]).join(ref, on=["nfl_id", "frame_id"])
gap = max((got["x"] - got["x_pred"]).abs().max(), (got["y"] - got["y_pred"]).abs().max())
print(f"play {game} {play_id}: {len(reply['predictions'])} predictions from {reply['model']}, "
      f"{got.height} of {ref.height} pipeline rows matched, largest gap {gap:.2e} yards")
if not got.height == ref.height == len(reply["predictions"]) or gap > 1e-3:
    sys.exit("the api does not match the pipeline")

status, reply = post(json.loads(play.drop("x").write_json()))
print(f"bad request answered {status}: {reply}")
if status != 400:
    sys.exit("a bad request must be answered with a 400")
print("api check passed")
