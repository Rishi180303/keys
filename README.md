# keys

I am building a machine learning project on NFL tracking data from the 2026 Big Data Bowl on Kaggle. I am a big football fan, so this is the kind of thing I would poke at anyway.

Here is the idea. The moment a quarterback lets the ball go, the targeted receiver and the defenders closest to the play all start moving toward the spot where it will land. The NFL records every player ten times a second. This project trains a model to predict those paths from the throw until the ball arrives.

The model does three jobs. It sits behind an API that takes a play and returns predicted paths. It gives every defender a rating by comparing what the defender actually did with what the model expected. And it feeds a website where you can watch real plays next to the model's guesses.

The stack is Python, PyTorch and Terraform, and everything runs on AWS.

## status

The model trains in AWS and now answers requests through a small web API. Five folds run as one pipeline and the held out error averages 0.57 yards on the forty frame cut, against 1.61 for constant velocity. Next up is the defender rating.

## api

The API takes one play and returns a predicted path for every player the play flags, one point per frame until the ball lands, each with a spread in yards.

Send a POST to /predict with a JSON body of the form {"rows": [...]}. Each row is one player at one frame before the throw, with the same 23 columns as the Kaggle input files. The reply names the model and holds one entry per predicted player and frame: nfl_id, frame_id, x, y, sd_x and sd_y. A request the API cannot use gets a 400 and a short message saying what is wrong.

The address is not public yet. The website will use it once it exists.

## data

The tracking data comes from the NFL Big Data Bowl 2026 competition on Kaggle. It is about 1.6 GB of CSV files and it is not in this repo. Download it from Kaggle and put the two folders in the project directory.
