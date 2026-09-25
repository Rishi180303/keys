"""Filesystem roots, overridable through the environment so containers can point them anywhere."""

import os
from pathlib import Path

RAW = Path(os.environ.get("KEYS_RAW", "nfl-big-data-bowl-2026-prediction/train"))
DATA = Path(os.environ.get("KEYS_DATA", "data"))
MODELS = Path(os.environ.get("KEYS_MODELS", "models"))
SUPPLEMENTARY = Path(
    os.environ.get("KEYS_SUPPLEMENTARY", "114239_nfl_competition_files_published_analytics_final/supplementary_data.csv")
)
