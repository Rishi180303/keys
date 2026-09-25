# phase three report, part one: the rating

Closing over expected, computed on run 2026-09-22T13-56 by the rate stage on 2026-09-24. Every number below is also in the site's meta file.

The rating compares where a flagged coverage defender actually was when the ball arrived with where the model expected him, along the line to the ball, in units of the model's own spread, against defenders in the same situation. The design doc's first version, distance in yards from the model's mean position, was tried on this run and failed a skeptic review: it was a deep ball metric, it penalized tight coverage for geometry alone, and its leaderboard did not agree with itself between halves of the season. The spec records what changed and why.

| what | value |
|---|---|
| flagged defender plays | 31,937 |
| excluded, out of bounds | 520 |
| excluded, not catchable | 1,845 |
| excluded, over 40 frames | 14 |
| rated plays | 29,558 |
| defenders with 30 or more rated plays | 320 |
| split half reliability, even against odd game ids | 0.537 over 273 players |
| shrinkage k, CB | 48.5 |
| shrinkage k, S | 29.2 |
| shrinkage k, LB | 27.8 |
| clearly above average | 22 |
| clearly below average | 27 |

The gate passed. The worst situational cell was COVER_2_ZONE at 0.18 of the spread of player means, against a limit of 0.25. Interceptions sit at +0.11 and teams run from Minnesota at +0.16 to Seattle at −0.16; both are reported, neither is gated.

Top of the list, shrunk rating in model spread units: Azeez Al-Shaair 0.52, Blake Cashman 0.48, Sydney Brown 0.44, Denzel Ward 0.35, Camryn Bynum 0.34, Daxton Hill 0.32, Christian Harris 0.32, Quan Martin 0.31. Bottom: Jamal Adams −0.55, Quandre Diggs −0.53, Tyrann Mathieu −0.49, Marcus Epps −0.47.

The rating does not predict outcomes: its correlation with completion rate allowed and EPA per play across listed players is under 0.1 in size. It is a movement stat and the site will say so.

The rate stage ran once on Fargate at 2 vCPU and 8 GB: 2.2 minutes from 20:23:42 to 20:25:55 Pacific time on 2026-09-24, measured from image pull to stop, about $0.004. It wrote 274 files, 228 MB, to the site bucket.
