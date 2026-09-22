import polars as pl
import pytest

from keys.metric import evaluate_predictions, kaggle_rmse, markdown_table, report


def test_kaggle_rmse_hand_example():
    # mse_x = (9 + 0) / 2 = 4.5, mse_y = (0 + 16) / 2 = 8, sqrt(0.5 * 12.5) = 2.5
    assert abs(kaggle_rmse([0, 0], [0, 0], [3, 0], [0, 4]) - 2.5) < 1e-9


def test_report_cuts():
    df = pl.DataFrame(
        {"x": [0.0, 0.0, 0.0], "y": [0.0, 0.0, 0.0], "x_pred": [1.0, 0.0, 2.0], "y_pred": [0.0, 0.0, 0.0],
         "player_role": ["Targeted Receiver", "Defensive Coverage", "Defensive Coverage"],
         "frame_id": [5, 10, 5], "num_frames_output": [10, 10, 50]}
    )
    r = report(df)
    assert set(r) >= {"all", "le40", "role_Targeted_Receiver", "role_Defensive_Coverage", "frame_5", "frame_10"}
    assert abs(r["le40"] - kaggle_rmse([0, 0], [0, 0], [1, 0], [0, 0])) < 1e-9
    assert r["frame_10"] == 0.0


def test_evaluate_predictions_joins_on_frame(synthetic_play):
    inp, out = synthetic_play
    pred = out.rename({"x": "x_pred", "y": "y_pred"})
    r = evaluate_predictions(pred, inp, out)
    assert r["all"] == 0.0 and r["role_Targeted_Receiver"] == 0.0


def test_markdown_table_has_columns():
    text = markdown_table({"hold": {"all": 4.1, "le40": 4.0}, "model": {"all": 0.5, "le40": 0.49}})
    assert "| cut | hold | model |" in text and "| le40 | 4.000 | 0.490 |" in text


def test_evaluate_predictions_missing_row(synthetic_play):
    inp, out = synthetic_play
    pred = out.rename({"x": "x_pred", "y": "y_pred"})
    # Drop the first row to have a missing prediction
    pred = pred[1:]
    with pytest.raises(ValueError, match="target rows have no predictions"):
        evaluate_predictions(pred, inp, out)


def test_evaluate_predictions_duplicate_row(synthetic_play):
    inp, out = synthetic_play
    pred = out.rename({"x": "x_pred", "y": "y_pred"})
    # Duplicate the first row to have a duplicate prediction
    pred = pl.concat([pred, pred[:1]])
    with pytest.raises(ValueError, match="predictions cover"):
        evaluate_predictions(pred, inp, out)
