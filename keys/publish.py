"""Combine the fold reports into one summary and point the API at the new model."""

import json
from pathlib import Path

from keys import sync

PARAMETER = "/keys/active-model"


def summarize(reports: list[dict]) -> dict:
    """Mean, min and max of every cut across the folds that reported it."""
    cuts = sorted({c for r in reports for c in r})
    out = {}
    for c in cuts:
        vals = [r[c] for r in reports if c in r]
        out[c] = {"mean": sum(vals) / len(vals), "min": min(vals), "max": max(vals), "folds": len(vals)}
    return out


def publish(run: str, bucket: str, s3, ssm, workdir) -> dict:
    workdir = Path(workdir)
    files = sync.pull(bucket, f"models/{run}/", workdir / "models", s3=s3)
    reports = [json.loads(f.read_text()) for f in sorted(files) if f.name == "report.json"]
    if not reports:
        raise ValueError(f"no report.json under models/{run}/")
    summary = summarize(reports)
    local = workdir / f"{run}.json"
    local.write_text(json.dumps(summary, indent=2))
    sync.push_file(local, bucket, f"summary/{run}.json", s3=s3)
    ssm.put_parameter(Name=PARAMETER, Value=f"models/{run}/fold0/model.pt", Type="String", Overwrite=True)
    return summary
