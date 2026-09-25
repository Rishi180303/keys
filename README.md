# keys

I am building a machine learning project on NFL tracking data from the 2026 Big Data Bowl on Kaggle. I am a big football fan, so this is the kind of thing I would poke at anyway.

Here is the idea. The moment a quarterback lets the ball go, the targeted receiver and the defenders closest to the play all start moving toward the spot where it will land. The NFL records every player ten times a second. This project trains a model to predict those paths from the throw until the ball arrives.

The model does three jobs. It sits behind an API that takes a play and returns predicted paths. It gives every defender a rating by comparing what the defender actually did with what the model expected. And it feeds a website where you can watch real plays next to the model's guesses.

The stack is Python, PyTorch and Terraform, and everything runs on AWS.

## status

The model trains in AWS and answers requests through a small web API. Five folds run as one pipeline and the held out error averages 0.57 yards on the forty frame cut, against 1.61 for constant velocity. The pipeline now also rates every flagged coverage defender and publishes the data for a website. The website itself is next.

## api

The API takes one play and returns a predicted path for every player the play flags, one point per frame until the ball lands, each with a spread in yards.

Send a POST to /predict with a JSON body of the form {"rows": [...]}. Each row is one player at one frame before the throw, with the same 23 columns as the Kaggle input files. The reply names the model and holds one entry per predicted player and frame: nfl_id, frame_id, x, y, sd_x and sd_y. A request the API cannot use gets a 400 and a short message saying what is wrong.

The address is not public yet. The website will use it once it exists, and the rating below already does.

## rating

Every flagged coverage defender gets a number called closing over expected. Knowing where and when the ball came down, the model predicts where a typical defender would be at the catch point from this player's spot at the throw. The rating is how much closer he actually got, measured in units of how sure the model was, compared with defenders on the same kind of throw, in the same role, at the same position, against the same route, and averaged over his plays. It is a movement stat. It says nothing about whether the pass was completed.

The rating is computed inside the pipeline after the model is published, and it has to pass its own checks before anything is written for the site: no coverage scheme, route, air time, starting distance, role or position moves the average by more than a quarter of the spread between players, and a defender's number in half the season has to line up with his number in the other half. If a check fails the site keeps the last data that passed.

## data

The tracking data comes from the NFL Big Data Bowl 2026 competition on Kaggle. It is about 1.6 GB of CSV files and it is not in this repo. Download it from Kaggle and put the two folders in the project directory.
