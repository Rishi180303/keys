import base64
import json
from types import SimpleNamespace

import polars as pl
import pytest

from keys import serve, tensors
from keys.model import KeysNet

CTX = SimpleNamespace(aws_request_id="req-1")


@pytest.fixture
def model(monkeypatch):
    net = KeysNet(n_feat=len(tensors.FEATURES), n_static=tensors.N_STATIC, d=32, layers=1, heads=2)
    monkeypatch.setattr(serve, "active_model", lambda: (net, "models/test/fold0/model.pt"))
    return net


def _event(rows):
    return {"body": json.dumps({"rows": rows}), "isBase64Encoded": False}


def _call(event):
    reply = serve.handler(event, CTX)
    return reply["statusCode"], json.loads(reply["body"])


def test_good_request_returns_every_predicted_frame(synthetic_play, model):
    inp, _ = synthetic_play
    status, body = _call(_event(inp.to_dicts()))
    assert status == 200 and body["model"] == "models/test/fold0/model.pt"
    assert len(body["predictions"]) == 12
    assert set(body["predictions"][0]) == {"nfl_id", "frame_id", "x", "y", "sd_x", "sd_y"}


def test_text_player_to_predict_reads_like_the_csv(synthetic_play, model):
    inp, _ = synthetic_play
    rows = [{**r, "player_to_predict": "True" if r["player_to_predict"] else "False"} for r in inp.to_dicts()]
    assert _call(_event(rows)) == _call(_event(inp.to_dicts()))


def test_base64_body_is_decoded(synthetic_play, model):
    inp, _ = synthetic_play
    body = base64.b64encode(json.dumps({"rows": inp.to_dicts()}).encode()).decode()
    assert _call({"body": body, "isBase64Encoded": True}) == _call(_event(inp.to_dicts()))


def test_missing_column_is_a_400_that_names_it(synthetic_play, model):
    inp, _ = synthetic_play
    status, body = _call(_event(inp.drop("ball_land_x").to_dicts()))
    assert status == 400 and "ball_land_x" in body["error"]


def test_two_plays_is_a_400(synthetic_play, model):
    inp, _ = synthetic_play
    two = pl.concat([inp, inp.with_columns(play_id=pl.lit(2, dtype=pl.Int64))])
    status, body = _call(_event(two.to_dicts()))
    assert status == 400 and "exactly one play" in body["error"]


def test_wrongly_typed_value_is_a_400(synthetic_play, model):
    inp, _ = synthetic_play
    rows = inp.to_dicts()
    rows[0]["x"] = "fifty"
    status, body = _call(_event(rows))
    assert status == 400 and "'x'" in body["error"]


def test_bad_json_is_a_400(model):
    status, _ = _call({"body": "{not json", "isBase64Encoded": False})
    assert status == 400


def test_bad_input_never_loads_the_model(synthetic_play, monkeypatch):
    def refuse():
        raise AssertionError("the model was loaded for a bad request")

    monkeypatch.setattr(serve, "active_model", refuse)
    inp, _ = synthetic_play
    status, _ = _call(_event(inp.drop("x").to_dicts()))
    assert status == 400


def test_model_failure_is_a_500_with_the_request_id(synthetic_play, monkeypatch):
    def broken():
        raise RuntimeError("s3 unreachable")

    monkeypatch.setattr(serve, "active_model", broken)
    inp, _ = synthetic_play
    status, body = _call(_event(inp.to_dicts()))
    assert status == 500 and body == {"error": "internal error", "request_id": "req-1"}


def test_nested_body_is_a_400(model):
    status, body = _call({"body": "[" * 100000, "isBase64Encoded": False})
    assert status == 400 and "could not read the request" in body["error"]


@pytest.mark.parametrize(
    ("column", "value", "named"),
    [
        ("player_role", "Kicker", "player_role"),
        ("player_height", "tall", "player_height"),
        ("play_direction", "up", "play_direction"),
        ("num_frames_output", 500, "num_frames_output"),
        ("x", float("nan"), "'x'"),
        ("x", float("inf"), "'x'"),
    ],
)
def test_bad_value_is_a_400_that_names_it(synthetic_play, model, column, value, named):
    inp, _ = synthetic_play
    status, body = _call(_event([{**r, column: value} for r in inp.to_dicts()]))
    assert status == 400 and named in body["error"]


def test_overflowing_number_is_a_400(synthetic_play, model):
    inp, _ = synthetic_play
    text = json.dumps({"rows": [{**r, "x": 123456.0} for r in inp.to_dicts()]}).replace("123456.0", "1e400")
    status, body = _call({"body": text, "isBase64Encoded": False})
    assert status == 400 and "'x'" in body["error"]


def test_too_many_players_is_a_400(synthetic_play, model):
    inp, _ = synthetic_play
    many = pl.concat([inp.with_columns(nfl_id=pl.col("nfl_id") + 10 * i) for i in range(11)])
    status, body = _call(_event(many.to_dicts()))
    assert status == 400 and "at most 30 players" in body["error"]


def test_warm_ping_drops_a_model_that_is_no_longer_published(monkeypatch):
    monkeypatch.setattr(serve, "_cache", {"model": "old", "version": "models/old/fold0/model.pt"})
    monkeypatch.setattr(serve, "published", lambda: "models/new/fold0/model.pt")
    assert serve.handler({"warm": True}, CTX) == {"statusCode": 204}
    assert serve._cache == {}


def test_warm_ping_keeps_the_current_model(monkeypatch):
    monkeypatch.setattr(serve, "_cache", {"model": "current", "version": "models/new/fold0/model.pt"})
    monkeypatch.setattr(serve, "published", lambda: "models/new/fold0/model.pt")
    assert serve.handler({"warm": True}, CTX) == {"statusCode": 204}
    assert serve._cache["model"] == "current"
