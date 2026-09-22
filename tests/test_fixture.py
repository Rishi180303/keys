def test_fixture_shape(synthetic_play):
    inp, out = synthetic_play
    assert inp.height == 36 and out.height == 12
    assert inp["player_to_predict"].sum() == 24
    assert set(out["nfl_id"].unique().to_list()) == {2, 3}
