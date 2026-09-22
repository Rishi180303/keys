"""Fixed size arrays per play for the model."""

import numpy as np
import polars as pl
import torch

T, H = 20, 40
FEATURES = ["rx", "ry", "vx", "vy", "ox", "oy", "s", "a", "dist_ball", "bx", "by", "dist_recv"]
MIRROR = [FEATURES.index(c) for c in ("ry", "vy", "oy", "by")]  # y components change sign under a mirror
ROLES = ["Passer", "Targeted Receiver", "Defensive Coverage", "Other Route Runner"]
GROUPS = {
    "QB": 0, "RB": 1, "FB": 1, "WR": 2, "TE": 3, "CB": 4, "FS": 4, "SS": 4, "S": 4, "DB": 4,
    "ILB": 5, "MLB": 5, "OLB": 5, "LB": 5, "DE": 6, "DT": 6, "NT": 6,
}
I_SIDE, I_GROUP, I_HEIGHT, I_WEIGHT, I_PREDICTED, I_NFO = 4, 5, 12, 13, 14, 15
N_STATIC = 16


def add_frame_features(inp: pl.DataFrame) -> pl.DataFrame:
    """inp must be normalized. Adds orientation unit vector, landing spot distance and bearing, receiver distance."""
    recv = inp.filter(pl.col("player_role") == "Targeted Receiver").select(
        "game_id", "play_id", "frame_id", pl.col("rx").alias("recv_rx"), pl.col("ry").alias("recv_ry")
    )
    df = inp.join(recv, on=["game_id", "play_id", "frame_id"], how="left")
    dist = (pl.col("rx") ** 2 + pl.col("ry") ** 2).sqrt()
    return df.with_columns(
        ox=pl.col("o").radians().sin(),
        oy=pl.col("o").radians().cos(),
        dist_ball=dist,
        bx=-pl.col("rx") / (dist + 1e-6),
        by=-pl.col("ry") / (dist + 1e-6),
        dist_recv=((pl.col("rx") - pl.col("recv_rx")) ** 2 + (pl.col("ry") - pl.col("recv_ry")) ** 2).sqrt().fill_null(0.0),
    )


def height_inches(text: str) -> float:
    feet, inches = text.split("-")
    return 12.0 * int(feet) + int(inches)


def build_play(pinp: pl.DataFrame, pout: pl.DataFrame | None) -> dict:
    """pinp is one play after normalize and add_frame_features. pout is that play's normalized targets or None."""
    players = pinp.sort(["nfl_id", "frame_id"]).partition_by("nfl_id", maintain_order=True)
    n_players = len(players)
    feat = np.zeros((n_players, T, len(FEATURES)), np.float32)
    fmask = np.zeros((n_players, T), bool)
    static = np.zeros((n_players, N_STATIC), np.float32)
    target = np.zeros((n_players, H, 2), np.float32)
    tmask = np.zeros((n_players, H), bool)
    last_xy = np.zeros((n_players, 2), np.float32)
    ids = []
    nfo = int(pinp["num_frames_output"][0])
    for i, rows in enumerate(players):
        rows = rows.tail(T)
        n = rows.height
        feat[i, T - n :] = rows.select(FEATURES).to_numpy()
        fmask[i, T - n :] = True
        r = rows.row(-1, named=True)
        ids.append(int(r["nfl_id"]))
        static[i, ROLES.index(r["player_role"])] = 1.0
        static[i, I_SIDE] = float(r["player_side"] == "Offense")
        static[i, I_GROUP + GROUPS.get(r["player_position"], 6)] = 1.0
        static[i, I_HEIGHT] = height_inches(r["player_height"]) / 80.0
        static[i, I_WEIGHT] = r["player_weight"] / 300.0
        static[i, I_PREDICTED] = float(r["player_to_predict"])
        static[i, I_NFO] = nfo / 40.0
        last_xy[i] = (r["x"], r["y"])
        if pout is not None and r["player_to_predict"]:
            o = pout.filter(pl.col("nfl_id") == r["nfl_id"]).sort("frame_id").head(H)
            k = o.height
            target[i, :k, 0] = o["x"].to_numpy() - r["x"]
            target[i, :k, 1] = o["y"].to_numpy() - r["y"]
            tmask[i, :k] = True
    return {
        "game_id": int(pinp["game_id"][0]), "play_id": int(pinp["play_id"][0]), "nfl_id": np.array(ids),
        "is_left": pinp["play_direction"][0] == "left", "nfo": nfo, "feat": feat, "fmask": fmask, "static": static,
        "target": target, "tmask": tmask, "last_xy": last_xy,
    }


def build_plays(inp: pl.DataFrame, out: pl.DataFrame | None) -> list[dict]:
    """One dict per play. inp normalized, out normalized or None for inference."""
    inp = add_frame_features(inp)
    outs = {key: g for key, g in out.group_by(["game_id", "play_id"])} if out is not None else {}
    return [build_play(g, outs.get(key)) for key, g in inp.group_by(["game_id", "play_id"], maintain_order=True)]


def collate(plays: list[dict]) -> dict:
    """Pad every array to the largest player count in the batch. pmask marks real players."""
    batch_size = len(plays)
    n_players = max(p["feat"].shape[0] for p in plays)
    batch = {}
    for name in ("feat", "fmask", "static", "target", "tmask", "last_xy"):
        arr = np.zeros((batch_size, n_players) + plays[0][name].shape[1:], plays[0][name].dtype)
        for b, p in enumerate(plays):
            arr[b, : p[name].shape[0]] = p[name]
        batch[name] = torch.from_numpy(arr)
    pmask = np.zeros((batch_size, n_players), bool)
    for b, p in enumerate(plays):
        pmask[b, : p["feat"].shape[0]] = True
    batch["pmask"] = torch.from_numpy(pmask)
    batch["plays"] = plays
    return batch
