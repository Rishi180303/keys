"""Copy files between S3 prefixes and local directories."""

from pathlib import Path

import boto3


def client():
    return boto3.client("s3")


def pull(bucket: str, prefix: str, dest, s3=None) -> list[Path]:
    """Download every object under prefix into dest, keeping the relative key. Returns the files written."""
    s3 = s3 or client()
    dest = Path(dest)
    written = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            rel = obj["Key"][len(prefix):].lstrip("/")
            if not rel:
                continue
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(bucket, obj["Key"], str(target))
            written.append(target)
    return written


def pull_file(bucket: str, key: str, dest, s3=None) -> Path:
    """Download one object to an exact path, creating the directory."""
    s3 = s3 or client()
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(dest))
    return dest


def push(src, bucket: str, prefix: str, s3=None, extra: dict | None = None) -> list[str]:
    """Upload every file under src (or src itself) to prefix, keeping the relative path. Returns the keys.

    extra is boto3's ExtraArgs for every object, for example Cache-Control and Content-Type."""
    s3 = s3 or client()
    src = Path(src)
    files = [src] if src.is_file() else sorted(p for p in src.rglob("*") if p.is_file())
    keys = []
    for f in files:
        rel = f.name if src.is_file() else f.relative_to(src).as_posix()
        keys.append(push_file(f, bucket, prefix.rstrip("/") + "/" + rel, s3=s3, extra=extra))
    return keys


def push_file(path, bucket: str, key: str, s3=None, extra: dict | None = None) -> str:
    """Upload one file to an exact key."""
    s3 = s3 or client()
    s3.upload_file(str(path), bucket, key, ExtraArgs=extra)
    return key
