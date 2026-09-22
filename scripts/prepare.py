"""Validate raw weeks and write parquet. Usage: uv run python scripts/prepare.py --weeks 1-18"""

import argparse

from keys.data import parse_weeks, prepare_week

parser = argparse.ArgumentParser()
parser.add_argument("--weeks", default="1-18")
for week in parse_weeks(parser.parse_args().weeks):
    prepare_week(week)
    print("week", week, "ok")
