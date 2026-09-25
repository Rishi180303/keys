"""Container entrypoint. Usage: python scripts/job.py prepare|train|score|publish|rate

Environment: KEYS_DATA_BUCKET and KEYS_ARTIFACTS_BUCKET (unset means local files only), KEYS_RUN
(default local), KEYS_FOLD (train only), KEYS_WEEKS (default 1-18), KEYS_EPOCHS (default 80),
KEYS_SITE_BUCKET and KEYS_API_URL (rate only).
Roots: KEYS_RAW, KEYS_DATA, KEYS_MODELS, see keys/paths.py."""

import json
import os
import sys
import time

import polars as pl

from keys import data, paths, publish, rate, score, site, sync, train

STAGE = sys.argv[1]
DATA_BUCKET = os.environ.get("KEYS_DATA_BUCKET")
ART_BUCKET = os.environ.get("KEYS_ARTIFACTS_BUCKET")
SITE_BUCKET = os.environ.get("KEYS_SITE_BUCKET")
RUN = os.environ.get("KEYS_RUN", "local")
WEEKS = data.parse_weeks(os.environ.get("KEYS_WEEKS", "1-18"))
EPOCHS = int(os.environ.get("KEYS_EPOCHS", "80"))


def stage_prepare():
    if DATA_BUCKET:
        sync.pull(DATA_BUCKET, "raw/", paths.RAW)
    for w in WEEKS:
        data.prepare_week(w)
        print("prepared week", w)
    if DATA_BUCKET:
        sync.push(data.PROCESSED, DATA_BUCKET, "processed/")


def stage_train():
    fold = int(os.environ["KEYS_FOLD"])
    if DATA_BUCKET:
        sync.pull(DATA_BUCKET, "processed/", data.PROCESSED)
    rep = train.train(WEEKS, fold, EPOCHS, run_name=f"{RUN}-fold{fold}")
    print("fold", fold, "report", json.dumps(rep))
    if ART_BUCKET:
        for name, key in ((f"fold{fold}.pt", "model.pt"), (f"fold{fold}.json", "report.json")):
            sync.push_file(paths.MODELS / name, ART_BUCKET, f"models/{RUN}/fold{fold}/{key}")


def stage_score():
    if DATA_BUCKET:
        sync.pull(DATA_BUCKET, "processed/", data.PROCESSED)
    if ART_BUCKET:
        sync.pull(ART_BUCKET, f"models/{RUN}/", paths.MODELS / RUN)
    checkpoints = {k: paths.MODELS / RUN / f"fold{k}" / "model.pt" for k in range(5)}
    checkpoints = {k: p for k, p in checkpoints.items() if p.exists()}
    if not checkpoints:
        raise FileNotFoundError(f"no checkpoints under {paths.MODELS / RUN}")
    df = score.score(checkpoints, WEEKS)
    out = paths.DATA / "predictions" / "predictions.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(out)
    print("scored", df.height, "rows with folds", sorted(checkpoints))
    if ART_BUCKET:
        sync.push_file(out, ART_BUCKET, f"predictions/{RUN}/predictions.parquet")


def stage_publish():
    if ART_BUCKET:
        import boto3

        summary = publish.publish(RUN, ART_BUCKET, boto3.client("s3"), boto3.client("ssm"), paths.MODELS / "publish")
    else:
        reports = [json.loads(p.read_text()) for p in sorted((paths.MODELS / RUN).glob("fold*/report.json"))]
        if not reports:
            raise FileNotFoundError(f"no report.json under {paths.MODELS / RUN}")
        summary = publish.summarize(reports)
        (paths.MODELS / "summary.json").write_text(json.dumps(summary, indent=2))
    print("summary", json.dumps(summary))


def stage_rate():
    sup_path = paths.SUPPLEMENTARY
    pred_path = paths.DATA / "predictions" / "predictions.parquet"
    summary_path = paths.MODELS / "summary.json"
    if DATA_BUCKET:
        sync.pull(DATA_BUCKET, "processed/", data.PROCESSED)
        sup_path = sync.pull_file(DATA_BUCKET, "raw/supplementary_data.csv", paths.RAW / "supplementary_data.csv")
    if ART_BUCKET:
        sync.pull_file(ART_BUCKET, f"predictions/{RUN}/predictions.parquet", pred_path)
        sync.pull_file(ART_BUCKET, f"summary/{RUN}.json", summary_path)
    inp, out = data.load_weeks(WEEKS)
    pred = pl.read_parquet(pred_path)
    sup = rate.load_supplementary(sup_path)
    result = rate.compute(inp, out, pred, sup)
    checks = result["checks"]
    ratings = paths.DATA / "ratings"
    ratings.mkdir(parents=True, exist_ok=True)
    result["table"].write_parquet(ratings / "plays.parquet")
    (ratings / "checks.json").write_text(json.dumps(checks, indent=2))
    if ART_BUCKET:
        sync.push(ratings, ART_BUCKET, f"ratings/{RUN}/")
    brief = {k: checks[k] for k in ("reliability", "league_mean", "excluded", "rows")}
    print("gate", "passed" if checks["passed"] else "failed", json.dumps(brief))
    if not checks["passed"]:
        raise ValueError("rating gate failed: " + "; ".join(checks["failed"]))
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else None
    generated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta = site.meta_json(RUN, os.environ.get("KEYS_API_URL", ""), summary, result, generated)
    dest = paths.DATA / "site"
    games = site.games_json(inp, out, pred, result["table"], sup)
    files = site.write_site(dest, site.plays_json(result["table"]), games, meta)
    if SITE_BUCKET:
        sync.push(dest, SITE_BUCKET, "data/", extra={"CacheControl": "max-age=300", "ContentType": "application/json"})
    print("site data", len(files), "files", "pushed to" if SITE_BUCKET else "written to", SITE_BUCKET or dest)


STAGES = {"prepare": stage_prepare, "train": stage_train, "score": stage_score, "publish": stage_publish, "rate": stage_rate}
STAGES[STAGE]()
