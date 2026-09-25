import importlib
import math
from pathlib import Path

import polars as pl
import pytest

FRAMES_IN, FRAMES_OUT = 12, 6


def reload_roots():
    """Re-read KEYS_RAW, KEYS_DATA and KEYS_MODELS from the environment in every module that captured them."""
    from keys import data, paths, train

    for module in (paths, data, train):
        importlib.reload(module)


@pytest.fixture
def roots(tmp_path, monkeypatch):
    """Point the data and model roots at a temp folder for one test, with no bucket variables set."""
    monkeypatch.setenv("KEYS_DATA", str(tmp_path / "data"))
    monkeypatch.setenv("KEYS_MODELS", str(tmp_path / "models"))
    for name in ("KEYS_DATA_BUCKET", "KEYS_ARTIFACTS_BUCKET", "KEYS_RUN", "KEYS_SITE_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    reload_roots()
    yield tmp_path
    monkeypatch.undo()
    reload_roots()


def _rows(nfl_id, name, pos, side, role, predict, x0, y0, s, direction):
    """Constant velocity player. Convention: vx = s * sin(dir), vy = s * cos(dir)."""
    vx = s * math.sin(math.radians(direction))
    vy = s * math.cos(math.radians(direction))
    rows = []
    for f in range(1, FRAMES_IN + 1):
        rows.append(
            {
                "game_id": 1, "play_id": 1, "player_to_predict": predict, "nfl_id": nfl_id, "frame_id": f,
                "play_direction": "right", "absolute_yardline_number": 50, "player_name": name,
                "player_height": "6-0", "player_weight": 200, "player_birth_date": "2000-01-01",
                "player_position": pos, "player_side": side, "player_role": role,
                "x": x0 + vx * 0.1 * (f - 1), "y": y0 + vy * 0.1 * (f - 1), "s": float(s), "a": 0.0,
                "dir": float(direction), "o": float(direction), "num_frames_output": FRAMES_OUT,
                "ball_land_x": 60.0, "ball_land_y": 20.0,
            }
        )
    return rows


@pytest.fixture
def synthetic_play():
    inp = pl.DataFrame(
        _rows(1, "Passer", "QB", "Offense", "Passer", False, 40.0, 25.0, 0.0, 0)
        + _rows(2, "Receiver", "WR", "Offense", "Targeted Receiver", True, 50.0, 20.0, 5.0, 90)
        + _rows(3, "Defender", "CB", "Defense", "Defensive Coverage", True, 55.0, 25.0, 4.0, 180)
    )
    out_rows = []
    for nfl_id in (2, 3):
        last = inp.filter(pl.col("nfl_id") == nfl_id).sort("frame_id").row(-1, named=True)
        vx = last["s"] * math.sin(math.radians(last["dir"]))
        vy = last["s"] * math.cos(math.radians(last["dir"]))
        for k in range(1, FRAMES_OUT + 1):
            out_rows.append(
                {"game_id": 1, "play_id": 1, "nfl_id": nfl_id, "frame_id": k,
                 "x": last["x"] + vx * 0.1 * k, "y": last["y"] + vy * 0.1 * k}
            )
    return inp, pl.DataFrame(out_rows)


@pytest.fixture
def rating_play(synthetic_play):
    """The synthetic play plus a far safety, with expected paths built so the rating values are known.

    Defender 3 (CB) ends 1.0 yards closer to the ball than expected along the line to it and defender 4 (FS)
    ends 0.5 yards farther. Every expected standard deviation is 0.5, so their z values are 2.0 and -1.0.
    Defender 3 is the closest expected, so it is primary and 4 is help."""
    from keys import train

    inp, out = synthetic_play
    inp = pl.concat([inp, pl.DataFrame(_rows(4, "Far Safety", "FS", "Defense", "Defensive Coverage", True, 80.0, 20.0, 4.0, 270))])
    last = inp.filter(pl.col("nfl_id") == 4).sort("frame_id").row(-1, named=True)
    vx = last["s"] * math.sin(math.radians(last["dir"]))
    vy = last["s"] * math.cos(math.radians(last["dir"]))
    extra = [
        {"game_id": 1, "play_id": 1, "nfl_id": 4, "frame_id": k, "x": last["x"] + vx * 0.1 * k, "y": last["y"] + vy * 0.1 * k}
        for k in range(1, FRAMES_OUT + 1)
    ]
    out = pl.concat([out, pl.DataFrame(extra)])
    land = (60.0, 20.0)
    shift = {3: -1.0, 4: 0.5}  # where the expected arrival sits along the line to the ball, relative to the actual one
    rows = []
    for r in out.sort("nfl_id", "frame_id").iter_rows(named=True):
        x, y = r["x"], r["y"]
        if r["frame_id"] == FRAMES_OUT and r["nfl_id"] in shift:
            dx, dy = land[0] - x, land[1] - y
            d = math.hypot(dx, dy)
            x, y = x + shift[r["nfl_id"]] * dx / d, y + shift[r["nfl_id"]] * dy / d
        rows.append({**r, "x_pred": x, "y_pred": y, "sd_x": 0.5, "sd_y": 0.5, "fold": train.fold_of(1)})
    pred = pl.DataFrame(rows).drop("x", "y")
    sup = pl.DataFrame({
        "game_id": [1], "play_id": [1], "week": [1], "home": ["KC"], "away": ["DET"], "off": ["DET"], "team": ["KC"],
        "desc": ["pass"], "q": [1], "clock": ["15:00"], "down": [1], "dist": [10], "result": ["C"], "route": ["GO"],
        "mz": ["zone"], "cov": ["COVER_3_ZONE"], "epa": [0.5],
    })
    return inp, out, pred, sup


class FakeS3:
    """Enough of a boto3 S3 client for pull, push and push_file: an in-memory bucket that records upload headers."""

    def __init__(self):
        self.store = {}
        self.extra = {}

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        store = self.store

        class Paginator:
            def paginate(self, Bucket, Prefix):
                keys = sorted(k for (b, k) in store if b == Bucket and k.startswith(Prefix))
                yield {"Contents": [{"Key": k} for k in keys]}

        return Paginator()

    def download_file(self, Bucket, Key, Filename):
        Path(Filename).write_bytes(self.store[(Bucket, Key)])

    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None):
        self.store[(Bucket, Key)] = Path(Filename).read_bytes()
        self.extra[(Bucket, Key)] = ExtraArgs


@pytest.fixture
def fake_s3():
    return FakeS3()


@pytest.fixture
def supplementary_csv(tmp_path):
    """The one play of rating_play in the raw supplementary format."""
    header = (
        "game_id,play_id,week,home_team_abbr,visitor_team_abbr,possession_team,defensive_team,play_description,quarter,"
        "game_clock,down,yards_to_go,pass_result,route_of_targeted_receiver,team_coverage_man_zone,team_coverage_type,"
        "expected_points_added"
    )
    path = tmp_path / "supplementary_data.csv"
    path.write_text(header + "\n1,1,1,KC,DET,DET,KC,pass,1,15:00,1,10,C,GO,ZONE_COVERAGE,COVER_3_ZONE,0.5\n")
    return path
