import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { groupName, signed } from "../lib/format";
import { loadHighlights, loadMeta, loadPlays } from "../lib/data";
import { board, mainTeam } from "../lib/people";
import type { PlayerRating } from "../lib/rating";
import { teamName } from "../lib/teams";
import type { Highlight, Meta, PlayRow } from "../lib/types";
import Replay from "../replay/Replay";
import { buildScene } from "../replay/scene";
import { Avatar, ReplayWait, useTitle } from "../ui";

const GROUPS = ["CB", "S", "LB"];

function Top({ grp, players }: { grp: string; players: PlayerRating[] }) {
  return (
    <div className="top">
      <h3>Top {groupName(grp)}</h3>
      <ol>
        {players.slice(0, 5).map((p, i) => (
          <li key={p.id}>
            <span className="rank">{i + 1}</span>
            <Avatar name={p.name} team={mainTeam(p)} />
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


export default function Home() {
  const [reel, setReel] = useState<Highlight[] | null>(null);
  const [reelError, setReelError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
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
          How much closer a defender got to the catch than the model expected. <Link to="/how">How it works</Link>
        </p>
      </section>

      <section className="tops" aria-label="the best defenders at each position">
        {boards ? (
          boards.map((b, i) => <Top key={GROUPS[i]} grp={GROUPS[i]} players={b} />)
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
    </div>
  );
}
