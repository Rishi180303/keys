import json

import pytest

from keys import publish


class FakeSSM:
    def __init__(self):
        self.params = {}

    def put_parameter(self, Name, Value, Type, Overwrite):
        self.params[Name] = Value


def test_summarize_mean_and_spread():
    s = publish.summarize([{"le40": 0.6, "all": 0.7}, {"le40": 0.8, "all": 0.9}, {"le40": 0.7}])
    assert s["le40"]["mean"] == pytest.approx(0.7)
    assert s["le40"]["min"] == 0.6 and s["le40"]["max"] == 0.8 and s["le40"]["folds"] == 3
    assert s["all"]["folds"] == 2


def test_publish_writes_summary_and_points_at_fold_zero(tmp_path, fake_s3):
    s3, ssm = fake_s3, FakeSSM()
    for k, v in enumerate((0.6, 0.7)):
        s3.store[("art", f"models/run1/fold{k}/report.json")] = json.dumps({"le40": v}).encode()
        s3.store[("art", f"models/run1/fold{k}/model.pt")] = b"w"
    summary = publish.publish("run1", "art", s3, ssm, tmp_path)
    assert summary["le40"]["mean"] == pytest.approx(0.65) and summary["le40"]["folds"] == 2
    assert json.loads(s3.store[("art", "summary/run1.json")])["le40"]["folds"] == 2
    assert ssm.params["/keys/active-model"] == "models/run1/fold0/model.pt"
