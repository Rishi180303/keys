# phase two report

First full execution of the pipeline on 2026-09-22, run 2026-09-22T13-56: prepare on Fargate, five fold training on Fargate at 80 epochs with early stopping, cross fitted scoring, publish. Yards, Kaggle metric, held out folds.

| cut | mean | min | max |
|---|---|---|---|
| all | 0.590 | 0.526 | 0.664 |
| le40 | 0.565 | 0.526 | 0.603 |
| role_Defensive_Coverage | 0.647 | 0.577 | 0.720 |
| role_Targeted_Receiver | 0.410 | 0.365 | 0.495 |
| frame_5 | 0.100 | 0.097 | 0.104 |
| frame_10 | 0.410 | 0.400 | 0.425 |
| frame_20 | 1.411 | 1.311 | 1.504 |
| frame_30 | 2.425 | 2.084 | 2.665 |

| fold | epochs run | le40 report | le40 score |
|---|---|---|---|
| 0 | 62 | 0.6031 | 0.6031 |
| 1 | 58 | 0.5627 | 0.5627 |
| 2 | 59 | 0.5255 | 0.5255 |
| 3 | 58 | 0.5506 | 0.5506 |
| 4 | 61 | 0.5841 | 0.5841 |

The report file and the score stage line agree to four decimals for every fold.

The headline number is the mean of five early stopped validation numbers, each chosen on the fold it reports, so it is a little optimistic in the usual way.

Wall clock was 30 minutes and 8 seconds, from 13:56:25 to 14:26:33 Pacific time.

The billing console lags a day, so the cost below is an estimate from the real task durations in the execution history, at Fargate list prices of 0.04048 dollars per vcpu hour and 0.004445 dollars per gb hour.

| stage | vcpu | gb | minutes | cost |
|---|---|---|---|---|
| prepare | 2 | 8 | 1.81 | $0.0035 |
| train 1 | 4 | 16 | 20.89 | $0.0811 |
| train 2 | 4 | 16 | 21.42 | $0.0832 |
| train 3 | 4 | 16 | 23.05 | $0.0895 |
| train 4 | 4 | 16 | 23.08 | $0.0896 |
| train 5 | 4 | 16 | 23.92 | $0.0929 |
| score | 2 | 8 | 3.06 | $0.0059 |
| publish | 2 | 8 | 1.34 | $0.0026 |

The total estimate is about $0.45. The billing console figure comes later.
