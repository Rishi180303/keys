# keys design

Date: 2026-09-21. Status: draft for review.

## goal

Build a model that predicts where NFL players go while a pass is in the air, then use that one model three ways: a live prediction API, a defender rating, and a public website. The project is a resume piece, so every technology in it has to do a real job that can be explained in one interview sentence. Both Kaggle competitions this data comes from ended in January 2026, so the point is not a leaderboard rank. The point is a system whose numbers can be checked against published results.

Non goals for now: beating the Kaggle winner, live NFL data, anything mobile.

## the data

Both Kaggle downloads share the same 36 training files, byte for byte. The analytics download adds a play context table. The prediction download adds a small test sample and Kaggle's inference API code.

| item | value |
|---|---|
| season | 2023, weeks 1 to 18, 272 games |
| plays | 14,108 pass plays, all with context rows in the supplementary file |
| trajectories to predict | 46,045, between 1 and 8 per play, usually 3 |
| who is predicted | the targeted receiver on every play and about a third of the coverage defenders, never the passer or other route runners |
| input per player | 9 to 74 frames before the throw, median 27, ten frames per second |
| given at the throw | ball landing x and y, and the number of frames to predict |
| frames to predict | minimum 5, median 10, 95th percentile 22, one play with 94 |
| rows | 4.9 million input rows, 563 thousand target rows, 1.6 GB of CSV |
| test sample | 3 games from December 2024 and January 2025, 143 plays, at most 30 frames per play |

Input columns: game_id, play_id, player_to_predict, nfl_id, frame_id, play_direction, absolute_yardline_number, player_name, player_height, player_weight, player_birth_date, player_position, player_side, player_role, x, y, s, a, dir, o, num_frames_output, ball_land_x, ball_land_y. Target columns: game_id, play_id, nfl_id, frame_id, x, y.

Facts verified on week 1 that the code must respect:

1. Velocity components are vx = s * sin(dir in radians) and vy = s * cos(dir in radians). Checked against frame to frame displacement, error 0.03 yards per frame. The other convention is off by twenty times that.
2. Output frame 1 is the frame right after the last input frame. The gap matches speed times one tenth of a second.
3. Input frames per player start at 1 and are contiguous. Output rows per player equal num_frames_output exactly.
4. Play direction is not normalized. About half the plays run left.
5. The ball landing y is outside the field on 12 of 819 week 1 plays. Keep them, do not clip.
6. Kaggle's live test never exceeded 40 frames per play. The one 94 frame play in week 1 carries 68 percent of the constant velocity squared error, so headline numbers are reported on plays of 40 frames or fewer, with the all plays number alongside.

The supplementary file has 18,009 plays including 2024 season plays without tracking. Useful columns: pass_result, pass_length, offense_formation, receiver_alignment, route_of_targeted_receiver, play_action, dropback_type, team_coverage_man_zone, team_coverage_type, defenders_in_the_box, expected_points_added, yards_gained.

## evaluation rules

The metric is Kaggle's: rmse = sqrt(0.5 * (mse_x + mse_y)) over every predicted row, in yards.

Folds are grouped by game_id, five folds. A game is never split across train and validation. Games are assigned to folds by a stable hash, crc32 of the game id modulo five, so every run uses the same split and folds are not correlated with the calendar.

Every report shows the same table: overall, plays of 40 frames or fewer, per role, and per horizon at frames 5, 10, 20 and 30.

Reference ladder in yards, so results always have context:

| approach | rmse | source |
|---|---|---|
| hold last position | 4.05 | our baseline, week 1, 40 frames or fewer |
| constant velocity | 1.55 | our baseline, week 1, 40 frames or fewer |
| public CatBoost residual notebook | 0.63 | Kaggle private leaderboard |
| public spatio temporal transformer notebook | 0.56 | Kaggle |
| first place | 0.463 | Kaggle private leaderboard |

Success for phase 1: a single model under 0.60 on held out folds on the 40 frame cut. Stretch: under 0.52. Anything above 0.80 means a bug, because a public model with no ball landing features scored 0.81.

## phase 1: data, baselines, model, all local

Runs on the Mac. No AWS.

### repo layout

```
keys/            python package
  data.py        csv to parquet, loading, validation
  features.py    normalization and tensor building
  baselines.py   hold, constant velocity, hybrid
  metric.py      kaggle rmse and the report table
  model.py       the network
  train.py       folds, training loop, mlflow logging
tests/           pytest, one small synthetic play as fixture
scripts/         thin command line entrypoints
docs/            this spec and later ones
```

Python 3.12 through uv. Dependencies: polars, numpy, torch, mlflow, pytest, ruff. No scikit learn, the fold hash is three lines.

### data step

Read each week's CSV pair with polars, validate the schema and the facts above, write one parquet file per week under data/processed. Loading a week must be fast enough that tests can use real data.

Normalization: flip plays that run left so the offense always moves toward positive x. Mirror y in the same flip. Recompute dir and o accordingly. All coordinates are then expressed relative to the ball landing spot, so the landing spot is the origin for every play.

### tensors

Each play becomes a fixed size block: one slot per player, sized to the largest play in the data, which is 14 in week 1, and the last 20 input frames per player, padded and masked when a player has fewer. Per frame per player: relative x and y, vx, vy, sin and cos of orientation, speed, acceleration, distance and bearing to the landing spot, distance to the targeted receiver. Per player static: role one hot, side, position group, height and weight, whether the player is predicted. Position groups: quarterback, back, receiver, tight end, defensive back, linebacker, defensive line. Per play: num_frames_output, which is a known input at the throw and matters a lot.

Targets: 40 future frames of displacement from the player's last input position, masked past num_frames_output. For the few plays longer than 40 frames, the prediction for every later frame is the frame 40 position held still, which is what the all plays report uses. Predicting displacement rather than position is the single most agreed on choice in the winning write ups.

### baselines

Three, all computed from the last input frame: hold position, constant velocity, and a hybrid that uses constant velocity for defenders and a straight line to the landing spot for the targeted receiver. These run first and their numbers go in every report.

### model, first version

Per player: a small 1D convolution over the 20 frame window. Across players: a two or three layer transformer encoder so each player sees where everyone else is. Head: for each predicted player and each of the 40 future frames, a mean displacement and a log variance in x and y. Loss: Gaussian negative log likelihood, masked to valid frames. Roughly a few hundred thousand parameters, which trains on the Mac's GPU in well under an hour per fold.

Augmentation in the first version: mirror across the field's long axis. Nothing else until the first numbers are in.

Training: AdamW, cosine schedule, exponential moving average of weights, early stopping on validation rmse. Every run logs parameters, the report table and the checkpoint to a local mlflow store.

Known upgrades from the winning write ups, applied one at a time only if the first version misses the target: time shift augmentation, which was worth the most in the winners' ablations, a Huber loss with time decay as a second head, treating the landing spot as its own node, larger ensembles.

### tests

Written before the code they test:

1. the angle convention, on a synthetic player moving at a known speed and direction
2. the flip is its own inverse and leaves the metric unchanged
3. the metric function matches Kaggle's formula on a hand computed example
4. output rows per player equal num_frames_output after loading a real week
5. tensor masks hide padded frames and unpredicted players
6. the model's forward pass returns the right shapes and no NaN on a batch from the fixture

### error handling

Validation happens once, at parquet writing time, and fails loudly. Training assumes clean data. A NaN loss stops the run with the batch's play ids printed.

## phase 2: aws pipeline and prediction api

Detailed in its own spec once phase 1 has a model. Decisions already made that it must respect:

1. Everything in us-east-1.
2. Services: S3 for data, artifacts, site files and Terraform state. IAM with GitHub OIDC so CI holds no keys. ECR for three images: prepare, train, serve. ECS Fargate for the prepare and batch scoring jobs. SageMaker Training Jobs on a spot GPU for training. Step Functions to run prepare, train one model per fold in parallel, evaluate, score and publish. A Lambda container image behind an API Gateway HTTP API for one play at a time inference, the same contract as Kaggle's evaluation API. SSM Parameter Store for the active model version. CloudWatch for logs, API latency, one alarm and one dashboard. AWS Budgets, already created. CloudFront for the site.
3. Deliberately left out: SQS, DynamoDB, Kinesis, EKS. Terraform locks state in S3 natively, the site data is static JSON, nothing is a queue or a stream.
4. Default VPC, public subnets, no NAT gateway.
5. The account is on the free plan until the project is done. IAM Identity Center is deferred because it would upgrade the plan. GPU training on SageMaker may be blocked on the free plan. If it is, phase 2 trains on the Mac and uploads the artifact, and the pipeline still runs prepare and scoring on Fargate. This gets decided by trying it.

## phase 3: defender rating and website

Detailed in its own spec after phase 2. Decisions already made:

1. The rating is closing over expected. For each predicted defender, take the distance from the defender to the landing spot at the ball's arrival frame. Compare the actual distance with the distance implied by the model's expected path. Positive means the defender got closer than the model expected.
2. Expected paths are cross fitted. Each game is scored by the fold model that never saw it.
3. Before any leaderboard is published the rating is checked against man versus zone rate, route, and time in the air. A rating that mostly measures coverage scheme is not a rating. The earlier attempt at this kind of metric failed exactly this check.
4. Ratings are shrunk toward the mean with a minimum sample size, reported per player and per team, with the number of plays shown next to every value.
5. The site is React with TypeScript and Vite on S3 and CloudFront: a play viewer with actual paths next to expected paths, the leaderboard with coverage and route filters, and a what if tool that moves the landing spot and calls the live API.

## conventions

Commit and writing rules live in rules.md, which is gitignored, and a local commit hook enforces the commit message rules. No secrets in chat, files or screenshots. The root AWS user stays parked. Daily work uses the rishi-admin IAM user.

## risks

1. The long tail of plays dominates squared error. Reporting the 40 frame cut handles the headline, and clamping predictions at 40 frames is an option for the model.
2. Sixteen gigabytes of memory on the Mac. Per week parquet and a fixed size tensor per play keep memory flat. Full data in tensors is roughly 14,108 plays times 14 slots times 20 frames times about 12 features, well under a gigabyte in float32.
3. The free plan may block GPU training. Covered in phase 2.
4. The rating may be confounded. Covered by the checks in phase 3, and the metric is not published until it passes them.
