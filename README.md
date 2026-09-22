# keys

I am building a machine learning project on NFL tracking data from the 2026 Big Data Bowl on Kaggle. I am a big football fan, so this is the kind of thing I would poke at anyway.

Here is the idea. The moment a quarterback lets the ball go, the targeted receiver and the defenders closest to the play all start moving toward the spot where it will land. The NFL records every player ten times a second. This project trains a model to predict those paths from the throw until the ball arrives.

The model does three jobs. It sits behind an API that takes a play and returns predicted paths. It gives every defender a rating by comparing what the defender actually did with what the model expected. And it feeds a website where you can watch real plays next to the model's guesses.

The stack is Python, PyTorch and Terraform, and everything runs on AWS.

## status

The baselines and the first model are in. On held out games the model lands at 0.67 yards of error on the forty frame cut, against 1.61 for the constant velocity baseline. Next up is the AWS pipeline.

## data

The tracking data comes from the NFL Big Data Bowl 2026 competition on Kaggle. It is about 1.6 GB of CSV files and it is not in this repo. Download it from Kaggle and put the two folders in the project directory.
