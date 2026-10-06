import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { groupName, signed } from "../lib/format";
import { loadHighlights, loadMeta, loadPhotos, loadPlays } from "../lib/data";
import { board, mainTeam } from "../lib/people";
import { rated, rateTeams, tierOf, type PlayerRating, type TeamRating } from "../lib/rating";
import { badge, teamName } from "../lib/teams";
import type { Highlight, Meta, Photos, PlayRow } from "../lib/types";
import Replay from "../replay/Replay";
import { buildScene } from "../replay/scene";
import { Avatar, Meter, ReplayWait, useTitle } from "../ui";

const GROUPS = ["CB", "S", "LB"];

function Top({ grp, players, photos }: { grp: string; players: PlayerRating[]; photos: Photos | null }) {
  return (
    <div className="top">
      <h3>Top {groupName(grp)}</h3>
      <ol>
        {players.slice(0, 5).map((p, i) => (
          <li key={p.id}>
            <span className="rank">{i + 1}</span>
            <Avatar id={p.id} name={p.name} team={mainTeam(p)} photos={photos} />
            <Link to={`/player/${p.id}`} className="who">
              <b>{p.name}</b>
              <span>{mainTeam(p)}</span>
            </Link>
            <span className={`num ${p.tier}`}>{signed(p.rating)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Defenses({ title, teams }: { title: string; teams: TeamRating[] }) {
  return (
    <div className="top">
      <h3>{title}</h3>
      <ol>
        {teams.map((t) => {
          const tier = tierOf(t.mean, t.se);
          return (
            <li key={t.team} className="team-row">
              <span className="swatch" style={{ background: badge(t.team).bg }} aria-hidden="true" />
              <span className="who">
                <b>{teamName(t.team)}</b>
                <span>{tier === "average" ? "average" : `${tier} average`}</span>
              </span>
              <Meter rating={t.mean} se={t.se} />
              <span className={`num ${tier}`}>{signed(t.mean)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Home() {
  const [reel, setReel] = useState<Highlight[] | null>(null);
  const [reelError, setReelError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [photos, setPhotos] = useState<Photos | null>(null);
  const [season, setSeason] = useState<{ rows: PlayRow[]; meta: Meta } | null>(null);
  const [tries, setTries] = useState(0);
  const [seasonError, setSeasonError] = useState<string | null>(null);
  const [seasonTries, setSeasonTries] = useState(0);
  useTitle();

  useEffect(() => {
    setReelError(null);
    loadHighlights()
      .then(setReel)
      .catch((e: Error) => setReelError(`The highlights did not load (${e.message}).`));
  }, [tries]);
  useEffect(() => {
    loadPhotos().then(setPhotos);
  }, []);
  // the season's plays are the heavy file, so they wait until the reel has started
  useEffect(() => {
    if (!reel && !reelError) return;
    const timer = setTimeout(() => {
      Promise.all([loadPlays(), loadMeta()])
        .then(([rows, meta]) => setSeason({ rows, meta }))
        .catch((e: Error) => setSeasonError(e.message));
    }, 600);
    return () => clearTimeout(timer);
  }, [reel, reelError, seasonTries]);

  const h = reel && reel.length ? reel[at % reel.length] : null;
  const scene = useMemo(() => (h ? buildScene(h.scene, h.id) : null), [h]);
  const boards = useMemo(() => (season ? GROUPS.map((g) => board(season.rows, season.meta, g)) : null), [season]);
  const teams = useMemo(() => (season ? rateTeams(rated(season.rows), season.meta.min_plays) : null), [season]);
  const step = (d: number) => reel && setAt((i) => (i + d + reel.length) % reel.length);

  return (
    <div className="home">
      <section className="hero" aria-label="highlights of the season">
        {scene && h ? (
          <Replay scene={scene} onEnd={() => step(1)} />
        ) : (
          <ReplayWait error={reelError} onRetry={() => setTries((n) => n + 1)} />
        )}
        {reel && h && (
          <div className="reel-bar">
            <p className="reel-game">
              Week {h.week}, {teamName(h.away)} at {teamName(h.home)}
            </p>
            <div className="reel-nav" role="group" aria-label="choose a highlight">
              <button type="button" className="arrow" onClick={() => step(-1)} aria-label="previous highlight">
                ‹
              </button>
              {reel.map((r, i) => (
                <button
                  key={`${r.game}-${r.play}`}
                  type="button"
                  className="dot"
                  aria-current={i === at % reel.length}
                  aria-label={`highlight ${i + 1} of ${reel.length}, ${r.name}`}
                  onClick={() => setAt(i)}
                />
              ))}
              <button type="button" className="arrow" onClick={() => step(1)} aria-label="next highlight">
                ›
              </button>
            </div>
            <Link className="watch" to={`/play/${h.game}/${h.play}?d=${h.id}`}>
              Watch the full play
            </Link>
          </div>
        )}
      </section>

      <section className="intro">
        <h1>Closing over expected</h1>
        <p>
          The moment a pass is thrown, a model trained on NFL tracking data predicts where a typical defender would end
          up when the ball arrives. The rating is how much closer to the catch point a defender actually got, compared
          with defenders in the same situation. <Link to="/how">How it works</Link>
        </p>
      </section>

      <section className="tops" aria-label="the best defenders at each position">
        {boards ? (
          boards.map((b, i) => <Top key={GROUPS[i]} grp={GROUPS[i]} players={b} photos={photos} />)
        ) : seasonError ? (
          <p className="season-error">
            The leaderboard did not load ({seasonError}).{" "}
            <button
              type="button"
              onClick={() => {
                setSeasonError(null);
                setSeasonTries((n) => n + 1);
              }}
            >
              Try again
            </button>
          </p>
        ) : (
          <p className="quiet">Loading the leaderboard</p>
        )}
      </section>
      {boards && (
        <p className="more">
          <Link to="/leaderboard">See every defender on the leaderboard</Link>
        </p>
      )}

      {teams && (
        <section className="tops two" aria-label="defenses">
          <Defenses title="Defenses that close best" teams={teams.slice(0, 5)} />
          <Defenses title="Defenses that close worst" teams={teams.slice(-5).reverse()} />
        </section>
      )}
    </div>
  );
}
