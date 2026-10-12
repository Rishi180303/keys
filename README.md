# keys

Closing over expected: a rating for NFL pass defenders, built from the league's own tracking data, with a website where you can watch every play it is based on.

Live at https://d2i4e06jgm34jr.cloudfront.net

## the idea

The NFL records where every player is ten times a second. When a quarterback throws, the receiver and the nearest defenders all break for the spot where the ball will land. I trained a model on the 2023 season to predict those paths, from the moment of the throw until the ball arrives.

That model is a yardstick. For every pass, it says where a typical defender would end up from this defender's starting spot. Closing over expected is how much closer he actually got, measured in units of how sure the model was, compared with defenders in the same situation. Average that over a season and you have a number for pursuit after the throw that does not depend on the scheme, the route, or how far away the defender started.

It is deliberately narrow. The model is told where the ball lands, so it cannot reward a defender for reading the play early, and it does not know whether the pass was caught. The leaderboard shows completion rate and EPA next to the rating on purpose, so you can see that it predicts neither.

## what you can do on the site

Watch the season's best plays replayed from the tracking data, with a broadcast camera, an overhead view, and a chase camera that rides along with the throw. Filter the leaderboard by position, coverage, route, role and team. Open any defender and watch his rated plays, best first. Open any play and see where the model expected each flagged defender to be against where he really was. Then move the landing spot, or change the air time, and the live model draws what it would expect instead.

## how good is the model

On held out plays of forty frames or fewer, the predicted paths are off by 0.57 yards on average. Assuming every player keeps running in a straight line is off by 1.61. Five folds train as one pipeline, so no play is ever scored by a model that saw it.

Before a rating is published it has to pass its own checks. No coverage scheme, route, air time, starting distance, role or position may move the average by more than a quarter of the spread between players, and a defender's number in half the season has to line up with his number in the other half. If a check fails, the site keeps the last data that passed.

## how it is built

Python, polars and PyTorch for the data and the model. The pipeline runs on AWS as Fargate jobs behind Step Functions, the API is a Lambda behind API Gateway, and the site is on CloudFront. All of it is Terraform. GitHub Actions tests, builds and deploys on every push to main, with no AWS keys stored anywhere.

The site is React and TypeScript. The replays are drawn on a canvas straight from the data, so there are no video files. The engine is checked against every real play in the season, about three million checks, before a release.

There are no faces on the site. Every player gets a badge in his team's colors, because I have no right to use NFL headshots.

## running it

The tracking data is about 1.6 GB and is not in this repo. Download it from the Kaggle Big Data Bowl 2026 page and put the two folders in the project directory. `uv run pytest` runs the Python tests. For the website, put the site's address in site/.env.local as KEYS_DATA_ORIGIN, then `npm install` and `npm run dev` inside site.
