import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { apiRows, predict } from "../lib/api";
import { loadGame, loadMeta } from "../lib/data";
import { label, ordinal, outcome, signed } from "../lib/format";
import { teamName } from "../lib/teams";
import type { Game, Meta } from "../lib/types";
import Replay, { type WhatIf } from "../replay/Replay";
import { buildScene, type Pt, type Scene } from "../replay/scene";
import { whatIfPaths } from "../replay/whatif";
import { ReplayWait } from "../ui";

/** After this long the status says the model may be waking up, which takes up to half a minute after a deploy. */
const SLOW_MS = 3000;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Ask = { paths: Map<number, Pt[]> | null; status: string; error: boolean };
const idle: Ask = { paths: null, status: "", error: false };

export default function Play() {
  const params = useParams();
  const [query] = useSearchParams();
  const gameId = Number(params.game);
  const playId = Number(params.play);
  const featured = query.get("d") ? Number(query.get("d")) : undefined;
  const [game, setGame] = useState<Game | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [editing, setEditing] = useState(false);
  // a moved spot and a changed air time belong to one scene, so they never leak into the next play
  const [moved, setMoved] = useState<{ scene: Scene; land: Pt | null; nfo: number | null } | null>(null);
  const [ask, setAsk] = useState<Ask>(idle);

  useEffect(() => {
    let stale = false;
    setError(null);
    setEditing(false);
    Promise.all([loadGame(gameId), loadMeta()])
      .then(([g, m]) => {
        if (stale) return;
        setGame(g);
        setMeta(m);
      })
      .catch((e: Error) => !stale && setError(`This game did not load (${e.message}).`));
    return () => {
      stale = true;
    };
  }, [gameId, tries]);

  const index = game && game.game === gameId ? game.plays.findIndex((p) => p.play === playId) : -1;
  const play = index >= 0 ? game!.plays[index] : null;
  const scene = useMemo(() => (play ? buildScene(play, featured) : null), [play, featured]);
  const mine = moved && moved.scene === scene ? moved : null;
  const land = mine?.land ?? null;
  const nfo = mine?.nfo ?? null;
  useEffect(() => setAsk(idle), [scene]);

  // a dropped spot or a new air time asks the live model, after the change has settled for 300 ms;
  // a newer change, a reset or leaving the play aborts the request in flight
  useEffect(() => {
    if (!scene || !play || !game || !meta || (land === null && nfo === null)) return;
    if (!meta.api_url) {
      setAsk({ ...idle, status: "This data has no address for the model.", error: true });
      return;
    }
    const ctl = new AbortController();
    let slow: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setAsk((a) => ({ ...a, status: "Asking the model", error: false }));
      slow = setTimeout(() => setAsk((a) => ({ ...a, status: "Still asking. The model can take up to half a minute to wake up." })), SLOW_MS);
      predict(meta.api_url, apiRows(game, play, land ? scene.toField(land) : play.land, nfo ?? play.nfo), ctl.signal)
        .then((answer) => !ctl.signal.aborted && setAsk({ paths: whatIfPaths(scene, answer), status: "Answered by the live model", error: false }))
        .catch((e: Error) => !ctl.signal.aborted && setAsk({ paths: null, status: e.message, error: true }))
        .finally(() => clearTimeout(slow));
    }, 300);
    return () => {
      ctl.abort();
      clearTimeout(timer);
      clearTimeout(slow);
    };
  }, [scene, play, game, meta, land, nfo]);

  if (error)
    return (
      <div className="play-page">
        <ReplayWait error={error} onRetry={() => setTries((n) => n + 1)} />
      </div>
    );
  if (!game || !meta || game.game !== gameId)
    return (
      <div className="play-page">
        <ReplayWait />
      </div>
    );
  if (!play || !scene) return <p className="page-msg">There is no play {playId} in this game.</p>;

  const byId = new Map(play.players.map((p) => [p.id, p]));
  const prev = game.plays[index - 1];
  const next = game.plays[index + 1];
  const air = nfo ?? play.nfo;
  const whatIf: WhatIf | null = editing
    ? { land: land ?? scene.land, paths: ask.paths, onLand: (p) => setMoved({ scene, land: p, nfo }) }
    : null;
  const reset = () => {
    setMoved(null);
    setAsk(idle);
  };

  return (
    <div className="play-page">
      <p className="crumbs">
        <Link to="/leaderboard">Leaderboard</Link>
        <span>
          Week {game.week}, {teamName(game.away)} at {teamName(game.home)}
        </span>
      </p>
      <Replay scene={scene} camera={editing ? "overhead" : null} loop={!editing} whatIf={whatIf} />

      <div className="play-grid">
        <section className="play-info">
          <h1>
            {teamName(play.off)} pass, {outcome(play.result)}
          </h1>
          <p className="desc">{play.desc}</p>
          <p className="context">
            {ordinal(play.down)} and {play.dist} in the {ordinal(play.q)} quarter, {play.clock} left. {cap(label(play.cov))}{" "}
            against a {label(play.route)} route, {(play.nfo / 10).toFixed(1)} seconds in the air.
          </p>
          <div className="scroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Flagged defender</th>
                  <th>Role</th>
                  <th className="n">At the throw</th>
                  <th className="n">Expected</th>
                  <th className="n">Actual</th>
                  <th className="n">Closer</th>
                  <th className="n">Over expected</th>
                </tr>
              </thead>
              <tbody>
                {play.ratings.map((r) => {
                  const p = byId.get(r.id);
                  return (
                    <tr key={r.id} className={r.ex ? "excluded" : ""}>
                      <td>
                        <Link to={`/player/${r.id}`}>{p?.name}</Link> <span className="pos">{p?.pos}</span>
                      </td>
                      <td>{r.role}</td>
                      <td className="n">{r.d0.toFixed(1)}</td>
                      <td className="n">{r.dexp.toFixed(1)}</td>
                      <td className="n">{r.dact.toFixed(1)}</td>
                      <td className="n">{signed(r.yards)}</td>
                      <td className="n">{r.ex ? `not rated, ${r.ex}` : signed(r.zc)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">
            Yards from the landing spot at the throw, where the model expected him when the ball arrived, and where he
            really was. Closer is how much nearer he got than expected along the line to the ball; over expected is that
            in the model's units, after the situation is taken out. The ball's flight is drawn; the tracking data has no
            ball.
          </p>
        </section>

        <section className="whatif" aria-label="what if">
          <h2>What if the ball went somewhere else?</h2>
          <p>
            Move the landing spot or change the air time and the live model draws where it would expect every flagged
            player to be. Drag the ring, or focus it and use the arrow keys (shift moves five yards).
          </p>
          {editing ? (
            <>
              <label className="air">
                Air time
                <input
                  type="range"
                  min={5}
                  max={40}
                  value={air}
                  onChange={(e) => setMoved({ scene, land, nfo: Number(e.target.value) })}
                />
                <span>{(air / 10).toFixed(1)} s</span>
              </label>
              <div className="whatif-buttons">
                <button type="button" onClick={reset}>
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setEditing(false);
                  }}
                >
                  Back to the replay
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="primary" onClick={() => setEditing(true)}>
              Try a what if
            </button>
          )}
          <p className={`status${ask.error ? " bad" : ""}`} aria-live="polite">
            {ask.status}
          </p>
          <p className="note">
            The answer comes from the published model, so its path for the real spot can differ a little from the cross
            fitted path in the replay.
          </p>
        </section>
      </div>

      <p className="pager">
        {prev ? <Link to={`/play/${game.game}/${prev.play}`}>Previous play in this game</Link> : <span />}
        {next && <Link to={`/play/${game.game}/${next.play}`}>Next play in this game</Link>}
      </p>
    </div>
  );
}
