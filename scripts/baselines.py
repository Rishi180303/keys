"""Print the baseline table. Usage: uv run python scripts/baselines.py --weeks 1"""

import argparse

from keys.baselines import baseline_reports
from keys.data import load_weeks, parse_weeks
from keys.metric import markdown_table

parser = argparse.ArgumentParser()
parser.add_argument("--weeks", default="1")
inp, out = load_weeks(parse_weeks(parser.parse_args().weeks))
print(markdown_table(baseline_reports(inp, out)))
