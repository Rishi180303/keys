# keys

I am building a machine learning project on NFL tracking data from the 2026 Big Data Bowl on Kaggle. I am a big football fan, so this is the kind of thing I would poke at anyway.

Here is the idea. The moment a quarterback lets the ball go, the targeted receiver and the defenders closest to the play all start moving toward the spot where it will land. The NFL records every player ten times a second. This project trains a model to predict those paths from the throw until the ball arrives.

The model does three jobs. It sits behind an API that takes a play and returns predicted paths. It gives every defender a rating by comparing what the defender actually did with what the model expected. And it feeds a website where you can watch real plays next to the model's guesses. The website is live at https://d2i4e06jgm34jr.cloudfront.net.

The stack is Python, PyTorch and Terraform, and everything runs on AWS.

## status

The model trains in AWS and answers requests through a small web API. Five folds run as one pipeline and the held out error averages 0.57 yards on the forty frame cut, against 1.61 for constant velocity. The pipeline rates every flagged coverage defender, checks the rating against the ways it could fool itself, and publishes the data for a website that is now live: a leaderboard, a play viewer with the model's expected paths next to the real ones, and a what if tool that moves the ball and asks the live model.

## api

The API takes one play and returns a predicted path for every player the play flags, one point per frame until the ball lands, each with a spread in yards.

Send a POST to /predict with a JSON body of the form {"rows": [...]}. Each row is one player at one frame before the throw, with the same 23 columns as the Kaggle input files. The reply names the model and holds one entry per predicted player and frame: nfl_id, frame_id, x, y, sd_x and sd_y. A request the API cannot use gets a 400 and a short message saying what is wrong.

The easiest way to try it is the what if tool on the website.

## rating

Every flagged coverage defender gets a number called closing over expected. Knowing where and when the ball came down, the model predicts where a typical defender would be at the catch point from this player's spot at the throw. The rating is how much closer he actually got, measured in units of how sure the model was, compared with defenders on the same kind of throw, in the same role, at the same position, against the same route, and averaged over his plays. It is a movement stat. It says nothing about whether the pass was completed.

The rating is computed inside the pipeline after the model is published, and it has to pass its own checks before anything is written for the site: no coverage scheme, route, air time, starting distance, role or position moves the average by more than a quarter of the spread between players, and a defender's number in half the season has to line up with his number in the other half. If a check fails the site keeps the last data that passed.

The same step picks eight highlights for the site. Each one is a different defender's best rated play among those where he was the defender expected closest to the ball, the throw hung in the air for at least a second and a half, and he ended up closer to the ball than expected. Every position group gets at least two. The pipeline saves them with everything a replay needs.

## site

The website is a small React app on CloudFront. It opens on a reel of the season's highlights. Each play is replayed from the tracking data on a canvas, with a broadcast camera behind the offense, an overhead camera and a chase camera that rides along with the throw. The tracking data has no ball, so its flight is drawn from the passer to the landing spot. The leaderboard is computed in the browser from a table of every rated defender play, so any mix of position, coverage, route, role and team works without a server, and a teams tab does the same for whole defenses. Every defender has a page with his card and a reel of his plays, best first. A play page shows one pass with the model's expected path for one featured defender and a table of every flagged defender's expected and actual distances, and its what if tool lets you move the landing spot or change the air time and asks the live API what the model would expect instead.

To run it locally, put the site's address in site/.env.local as KEYS_DATA_ORIGIN, then npm install and npm run dev inside site. The tests cover the rating math, the filters, the file format, the replay engine and the rows the what if tool sends to the API.

## photos

Player photos come from Wikimedia Commons, because I have no right to use NFL headshots. A separate job looks up every listed defender on Wikidata. It only accepts a football player with the same name and the same birth date, since a name alone is not enough to be sure. It keeps a picture when Commons lists it under a Creative Commons attribution or share alike license, under CC0, or as public domain, and skips one whose license Commons has not finished checking. It also saves the credit, the license and a link to the file page, so the site can credit every photo. On the 2023 season that found a photo for 217 of the 320 listed defenders. Two more are left out by hand: one picture turned out to show a different player, and one has a child in the frame. I run it by hand after the rating.

## data

The tracking data comes from the NFL Big Data Bowl 2026 competition on Kaggle. It is about 1.6 GB of CSV files and it is not in this repo. Download it from Kaggle and put the two folders in the project directory.
