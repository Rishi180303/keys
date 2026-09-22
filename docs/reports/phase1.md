# phase one report

Fold 0 of 5, games grouped by game id, trained on the other four folds. Yards, Kaggle metric.

| cut | hold | constant_velocity | hybrid | model |
|---|---|---|---|---|
| all | 4.212 | 1.709 | 1.681 | 0.742 |
| le40 | 4.198 | 1.608 | 1.592 | 0.671 |
| role_Defensive_Coverage | 4.034 | 1.816 | 1.816 | 0.802 |
| role_Targeted_Receiver | 4.628 | 1.404 | 1.281 | 0.562 |
| frame_5 | 1.801 | 0.401 | 0.616 | 0.106 |
| frame_10 | 3.890 | 1.455 | 1.454 | 0.433 |
| frame_20 | 9.528 | 3.747 | 3.652 | 1.563 |
| frame_30 | 14.354 | 6.223 | 6.164 | 2.715 |

Reference points from Kaggle: public CatBoost notebook 0.63, public transformer notebook 0.56, first place 0.463.

Model: 474272 parameters, 30 epochs, best epoch 29.
