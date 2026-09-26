import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { apiRows, predict, type Prediction } from "../lib/api";
import { loadGame, loadMeta } from "../lib/data";
import Field, { frameCount, inputFrames } from "../lib/field";
import type { Game, Meta } from "../lib/types";
import { signed } from "./Leaderboard";

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 10 < 4 && Math.floor(n / 10) !== 1 ? n % 10 : 0]}`;
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();
const outcome = (r: string) => (r === "C" ? "complete" : r === "I" ? "incomplete" : "intercepted");

type WhatIf = { result: Prediction | null; error: string | null; busy: boolean };
const idle: WhatIf = { result: null, error: null, busy: false };

export default function PlayViewer() {
  const params = useParams();
  const gameId = Number(params.game);
  const playId = Number(params.play);
  const [game, setGame] = useState<Game | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [land, setLand] = useState<[number, number] | null>(null);
  const [nfo, setNfo] = useState<number | null>(null);
  const [whatIf, setWhatIf] = useState<WhatIf>(idle);

  useEffect(() => {
    let stale = false;
    setGame(null);
    setT(0);
    setPlaying(false);
    setLand(null);
    setNfo(null);
    setWhatIf(idle);
    Promise.all([loadGame(gameId), loadMeta()])
      .then(([g, m]) => {
        if (stale) return;
        setGame(g);
        setMeta(m);
      })
      .catch((e: Error) => {
        if (!stale) setError(e.message);
      });
    return () => {
      stale = true;
    };
  }, [gameId, playId]);

  const index = game ? game.plays.findIndex((p) => p.play === playId) : -1;
  const play = index >= 0 ? game!.plays[index] : null;
  const frames = play ? frameCount(play) : 1;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((v) => (v + 1) % frames), 100);
    return () => clearInterval(id);
  }, [playing, frames]);

  // the what if request goes out on a dropped marker or a changed air time, never while dragging, debounced
  useEffect(() => {
    if (!game || !play || !meta || (land === null && nfo === null)) return;
    if (!meta.api_url) {
      setWhatIf({ result: null, error: "this data has no api address", busy: false });
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      setWhatIf((w) => ({ ...w, busy: true, error: null }));
      predict(meta.api_url, apiRows(game, play, land ?? play.land, nfo ?? play.nfo))
        .then((result) => {
          if (!stale) setWhatIf({ result, error: null, busy: false });
        })
        .catch((e: Error) => {
          if (!stale) setWhatIf({ result: null, error: e.message, busy: false });
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [game, play, meta, land, nfo]);

  if (error) return <p className="error">{error}</p>;
  if (!game || !meta) return <p className="loading">loading the game</p>;
  if (!play) return <p className="error">there is no play {playId} in game {gameId}</p>;
  const byId = new Map(play.players.map((p) => [p.id, p]));
  const nIn = inputFrames(play);
  const prev = game.plays[index - 1];
  const next = game.plays[index + 1];
  const air = nfo ?? play.nfo;

  return (
    <section className="viewer">
      <p className="crumbs">
        <Link to="/">leaderboard</Link> · week {game.week}, {game.away} at {game.home}
      </p>
      <h1>
        {play.off} pass, {outcome(play.result)}
      </h1>
      <p className="desc">{play.desc}</p>
      <p className="context">
        Q{play.q} {play.clock}, {ordinal(play.down)} and {play.dist}. {label(play.cov)} against a {label(play.route)}{" "}
        route, {(play.nfo / 10).toFixed(1)} seconds in the air.
      </p>
      <Field play={play} t={t} land={land ?? play.land} whatIf={whatIf.result} onLand={setLand} />
      <div className="controls">
        <button onClick={() => setPlaying(!playing)}>{playing ? "pause" : "play"}</button>
        <input
          type="range"
          aria-label="frame"
          min={0}
          max={frames - 1}
          value={t}
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
          }}
        />
        <span>{t < nIn ? `frame ${t + 1} of ${nIn} before the throw` : `frame ${t - nIn + 1} of ${play.nfo} in the air`}</span>
      </div>
      <p className="legend">
        <span className="sw actual" /> actual path <span className="sw expected" /> expected path, with the model's
        spread at arrival <span className="sw whatif" /> what if <span className="sw ball" /> landing spot
      </p>
      <div className="scroll">
      <table className="card">
        <thead>
          <tr>
            <th>flagged defender</th>
            <th>role</th>
            <th>yards to the ball at the throw</th>
            <th>expected at arrival</th>
            <th>actual at arrival</th>
            <th>yards closer</th>
            <th>rating</th>
          </tr>
        </thead>
        <tbody>
          {play.ratings.map((r) => {
            const p = byId.get(r.id);
            return (
              <tr key={r.id} className={r.ex ? "excluded" : ""}>
                <td>
                  {p?.name} <span className="pos">{p?.pos}</span>
                </td>
                <td>{r.role}</td>
                <td>{r.d0.toFixed(1)}</td>
                <td>{r.dexp.toFixed(1)}</td>
                <td>{r.dact.toFixed(1)}</td>
                <td>{signed(r.yards)}</td>
                <td>{r.ex ? `not rated, ${r.ex}` : signed(r.zc)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="whatif">
        <h2>what if</h2>
        <p>
          Drag the landing spot, or change the air time, and the live model draws where it would expect every flagged
          player to be. The model that answers is the published one, so its path for the real spot can differ a little
          from the cross fitted path above.
        </p>
        <label>
          air time
          <input type="range" min={5} max={40} value={air} onChange={(e) => setNfo(Number(e.target.value))} />
          {(air / 10).toFixed(1)} s
        </label>
        <button
          onClick={() => {
            setLand(null);
            setNfo(null);
            setWhatIf(idle);
          }}
        >
          reset
        </button>
        <span className="status">
          {whatIf.busy ? "asking the model" : whatIf.error ? whatIf.error : whatIf.result ? `model ${whatIf.result.model}` : ""}
        </span>
      </div>
      <p className="pager">
        {prev && <Link to={`/play/${game.game}/${prev.play}`}>previous play</Link>}
        {next && <Link to={`/play/${game.game}/${next.play}`}>next play</Link>}
      </p>
    </section>
  );
}
