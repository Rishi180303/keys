"""Lambda handler behind POST /predict: one play in, predicted paths out."""

import base64
import json
import logging
import os

import polars as pl
import torch

from keys import data, features, score, tensors, train
from keys.publish import PARAMETER

MAX_ROWS = 4000  # the largest real play has 1599 input rows
MAX_PLAYERS = 30  # the largest real play has 17 players; this also keeps a reply far below lambda's 6 MB
MAX_FRAMES_OUT = 100  # the longest real pass is 94 frames in the air
TYPES = {
    "game_id": pl.Int64, "play_id": pl.Int64, "player_to_predict": pl.Boolean, "nfl_id": pl.Int64,
    "frame_id": pl.Int64, "absolute_yardline_number": pl.Int64, "player_weight": pl.Int64,
    "num_frames_output": pl.Int64, "x": pl.Float64, "y": pl.Float64, "s": pl.Float64, "a": pl.Float64,
    "dir": pl.Float64, "o": pl.Float64, "ball_land_x": pl.Float64, "ball_land_y": pl.Float64,
}
SCHEMA = {c: TYPES.get(c, pl.String) for c in data.INPUT_COLUMNS}
log = logging.getLogger(__name__)
_cache = {}


def published() -> str:
    """The checkpoint key the SSM parameter names right now."""
    import boto3

    return boto3.client("ssm").get_parameter(Name=PARAMETER)["Parameter"]["Value"]


def active_model():
    """The checkpoint the SSM parameter names, downloaded into /tmp once per container."""
    if "model" not in _cache:
        import boto3

        key = published()
        path = "/tmp/model.pt"
        boto3.client("s3").download_file(os.environ["KEYS_ARTIFACTS_BUCKET"], key, path)
        _cache["model"], _cache["version"] = score.load_model(path), key
    return _cache["model"], _cache["version"]


def parse(event) -> list[dict]:
    """The request body as model inputs for exactly one play.

    Anything wrong with the request raises, and handler turns it into a 400 with the message."""
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode()
    # NaN and Infinity are not JSON; read them as nulls so the null check below names the column
    payload = json.loads(body, parse_constant=lambda _: None)
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows or not all(isinstance(r, dict) for r in rows):
        raise ValueError('body must be {"rows": [...]} with at least one row object')
    if len(rows) > MAX_ROWS:
        raise ValueError(f"at most {MAX_ROWS} rows, got {len(rows)}")
    missing = [c for c in data.INPUT_COLUMNS if not all(c in r for r in rows)]
    if missing:
        raise ValueError(f"rows are missing columns {missing}")
    # read the way load_week_raw reads the csv: the text true, in any case, means true
    rows = [{**r, "player_to_predict": str(r["player_to_predict"]).lower() == "true"} for r in rows]
    # column by column, so a value of the wrong type becomes a null the next check names
    df = pl.DataFrame([pl.Series(c, [r[c] for r in rows], dtype=t, strict=False) for c, t in SCHEMA.items()])
    infinite = [c for c, t in SCHEMA.items() if t == pl.Float64 and not df[c].is_finite().all()]
    bad = [c for c in data.INPUT_COLUMNS if df[c].null_count() or c in infinite]
    if bad:
        raise ValueError(f"null, infinite or wrongly typed values in {bad}")
    n_plays = df.select("game_id", "play_id").unique().height
    if n_plays != 1:
        raise ValueError(f"expected exactly one play, got {n_plays}")
    n_players = df["nfl_id"].n_unique()
    if n_players > MAX_PLAYERS:
        raise ValueError(f"at most {MAX_PLAYERS} players, got {n_players}")
    if not df["play_direction"].is_in(["left", "right"]).all():
        raise ValueError("play_direction must be left or right")
    if not df["player_role"].is_in(tensors.ROLES).all():
        raise ValueError(f"player_role must be one of {tensors.ROLES}")
    if not df["player_height"].str.contains(r"^\d+-\d+$").all():
        raise ValueError("player_height must look like 6-1")
    if not df["player_to_predict"].any():
        raise ValueError("no row has player_to_predict true")
    nfo = df["num_frames_output"]
    if nfo.n_unique() != 1 or not 1 <= nfo[0] <= MAX_FRAMES_OUT:
        raise ValueError(f"num_frames_output must be one value from 1 to {MAX_FRAMES_OUT}")
    return tensors.build_plays(features.normalize(df), None)


def handler(event, context):
    """API Gateway HTTP API entry point, payload format 2.0, and the five minute keep warm ping."""
    if event.get("warm"):
        # the ping keeps this container alive; drop the cached model once a newer run is published
        if _cache.get("version") != published():
            _cache.clear()
        return {"statusCode": 204}
    try:
        plays = parse(event)
    except (ValueError, pl.exceptions.PolarsError) as e:
        return _reply(400, {"error": str(e)})
    except Exception as e:
        # anything else parse raises comes from the request itself, a deeply nested body for one
        log.exception("unreadable request %s", context.aws_request_id)
        return _reply(400, {"error": f"could not read the request: {type(e).__name__}"})
    try:
        model, version = active_model()
        pred = train.predict(model, plays, torch.device("cpu"))
    except Exception:
        log.exception("predict failed, request %s", context.aws_request_id)
        return _reply(500, {"error": "internal error", "request_id": context.aws_request_id})
    xy = [pl.col("x_pred").alias("x"), pl.col("y_pred").alias("y")]
    out = pred.select("nfl_id", "frame_id", *xy, "sd_x", "sd_y")
    return _reply(200, {"model": version, "predictions": out.to_dicts()})


def _reply(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": {"content-type": "application/json"}, "body": json.dumps(body)}
