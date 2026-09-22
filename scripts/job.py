"""Container entrypoint. Usage: python scripts/job.py prepare|train|score|publish

Environment: KEYS_DATA_BUCKET and KEYS_ARTIFACTS_BUCKET (unset means local files only), KEYS_RUN
(default local), KEYS_FOLD (train only), KEYS_WEEKS (default 1-18), KEYS_EPOCHS (default 80).
Roots: KEYS_RAW, KEYS_DATA, KEYS_MODELS, see keys/paths.py."""

import json
import os
import sys

from keys import data, paths, publish, score, sync, train

STAGE = sys.argv[1]
DATA_BUCKET = os.environ.get("KEYS_DATA_BUCKET")
ART_BUCKET = os.environ.get("KEYS_ARTIFACTS_BUCKET")
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
        summary = publish.summarize(reports)
        (paths.MODELS / "summary.json").write_text(json.dumps(summary, indent=2))
    print("summary", json.dumps(summary))


{"prepare": stage_prepare, "train": stage_train, "score": stage_score, "publish": stage_publish}[STAGE]()
