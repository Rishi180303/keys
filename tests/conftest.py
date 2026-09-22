import math

import polars as pl
import pytest

FRAMES_IN, FRAMES_OUT = 12, 6


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
