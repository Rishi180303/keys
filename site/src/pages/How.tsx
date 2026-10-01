import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { loadMeta, loadPhotos, loadPlays } from "../lib/data";
import { label } from "../lib/format";
import type { Cell, Meta, Photos } from "../lib/types";

const DIMS: Record<string, string> = {
  cov: "coverage type",
  mz: "man or zone",
  start: "yards to the ball at the throw",
  route: "route",
  air: "frames in the air",
  role: "role",
  grp: "position group",
};
const REASONS: Record<string, string> = {
  "out of bounds": "the ball landed out of bounds",
  "not catchable": "the targeted receiver ended more than four yards from the landing spot",
  "over 40 frames": "the ball was in the air longer than forty frames",
};
const signed = (v: number | null, d = 3) => (v === null ? "" : (v < 0 ? "−" : "+") + Math.abs(v).toFixed(d));

/** Every photo the site shows, with its author, license and file page, as CC BY and CC BY-SA ask. */
function Credits() {
  const [photos, setPhotos] = useState<Photos | null>(null);
  const [names, setNames] = useState<Map<number, string> | null>(null);
  useEffect(() => {
    loadPhotos().then(setPhotos);
    loadPlays()
      .then((rows) => setNames(new Map(rows.map((r) => [r.id, r.name]))))
      .catch(() => setNames(new Map()));
  }, []);
  if (!photos || !names) return <p className="quiet">Loading the credits</p>;
  const list = Object.entries(photos)
    .map(([id, p]) => ({ id, name: names.get(Number(id)) ?? `Player ${id}`, ...p }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return <p>No photos are published right now, so every player shows his team badge.</p>;
  return (
    <ul className="credits">
      {list.map((c) => (
        <li key={c.id}>
          <b>{c.name}</b>: <a href={c.source}>photo</a> by {c.artist},{" "}
          {c.license_url ? <a href={c.license_url}>{c.license}</a> : c.license}
        </li>
      ))}
    </ul>
  );
}

export default function How() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { hash } = useLocation();
  useEffect(() => {
    loadMeta().then(setMeta).catch((e: Error) => setError(e.message));
  }, []);
  // the router does not scroll to a #part, and the headings only exist once meta has arrived
  useEffect(() => {
    if (meta && hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [meta, hash]);
  if (error) return <p className="page-msg">This page did not load ({error}).</p>;
  if (!meta) return <p className="page-msg quiet">Loading</p>;
  const g = meta.gate;
  const byDim = new Map<string, Cell[]>();
  for (const c of g.cells) byDim.set(c.dim, [...(byDim.get(c.dim) ?? []), c]);
  const le40 = meta.summary?.le40;

  return (
    <article className="how">
      <h1>How the rating works</h1>
      <p>
        The NFL records every player ten times a second. On a pass, the model is shown every player's last two seconds
        before the throw, where the ball will land, and how long it will take to get there. It answers with where it
        expects the targeted receiver and the flagged coverage defenders to be at every tenth of a second until the
        ball arrives, with a spread for each guess.
      </p>
      <p>
        Closing over expected takes each flagged defender at the moment the ball arrives, draws the line from the
        model's expected spot to the ball, and measures how much closer along that line he actually got. That number
        is divided by the model's spread along the same line, so a play the model was sure about counts for more than
        a coin flip. Then the average for the same kind of throw, the same role, the same position and the same route
        is subtracted, so a safety on deep balls and a slot corner on screens are judged against their own situations.
        A player's rating is the mean of those values over his rated plays, pulled toward zero by a per position
        constant so that a player with few plays cannot top the list on luck. It comes with a standard error, and a
        player is only called above or below average when the rating clears two of them.
      </p>
      <h2>What the model already knows</h2>
      <p>
        The model is told where and when the ball came down. So the rating cannot reward anticipation before the
        throw, cannot reward a defender for forcing a bad throw, and cannot see whether the pass was caught. It is a
        measure of pursuit after the throw, relative to the model's expectation. Across players it does not predict
        completion rate allowed or EPA; the leaderboard shows those next to it so that is plain to see. Only the
        defenders Kaggle flagged for prediction are rated, about two of the seven coverage defenders on a play, the
        ones near the throw.
      </p>
      <h2>Which plays count</h2>
      <p>
        Run {meta.run}: {g.rows.flagged.toLocaleString()} flagged defender plays, {g.rows.rated.toLocaleString()} rated,{" "}
        {g.rows.players_listed} defenders with at least {meta.min_plays} rated plays. Plays are left out when
      </p>
      <ul>
        {Object.entries(g.excluded.by_reason).map(([reason, n]) => (
          <li key={reason}>
            {REASONS[reason] ?? reason}: {n.toLocaleString()} plays
          </li>
        ))}
      </ul>
      <h2>The checks</h2>
      <p>
        A rating that mostly measures scheme is not a rating, so before anything is published the pipeline checks that
        no situation moves the average by more than a quarter of the spread between players (the limit here is{" "}
        {g.limit === null ? "unknown" : g.limit.toFixed(3)}), that a defender's number in games with even ids lines up
        with his number in games with odd ids (correlation {g.reliability.r === null ? "unknown" : g.reliability.r.toFixed(2)}{" "}
        over {g.reliability.players} players, at least 0.40 required), that the league mean sits at zero, and that fewer
        than fifteen percent of plays are excluded. Air time, role, position and route are near zero because they are
        centered; coverage, man or zone, and starting distance are the live checks. This run {g.passed ? "passed" : "failed"}.
      </p>
      <div className="scroll">
      <table className="checks">
        <thead>
          <tr>
            <th>situation</th>
            <th>cell</th>
            <th>plays</th>
            <th>mean</th>
            <th>ok</th>
          </tr>
        </thead>
        <tbody>
          {[...byDim].flatMap(([dim, cells]) =>
            cells.map((c, i) => (
              <tr key={`${dim}-${c.cell}`} className={c.ok ? "" : "bad"}>
                <td>{i === 0 ? DIMS[dim] ?? dim : ""}</td>
                <td>{dim === "grp" ? c.cell : label(c.cell)}</td>
                <td>{c.n.toLocaleString()}</td>
                <td>{signed(c.mean)}</td>
                <td>{c.ok ? "yes" : "no"}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      </div>
      <p>
        Reported but never gated, because one is an outcome the defender earned and the other cannot be separated from
        who plays for the team:{" "}
        {Object.entries(g.info)
          .map(([dim, cells]) => `${dim === "result" ? "pass result" : "team"} from ${signed(Math.min(...cells.map((c) => c.mean)), 2)} to ${signed(Math.max(...cells.map((c) => c.mean)), 2)}`)
          .join("; ")}
        .
      </p>
      <h2>Shrinkage</h2>
      <div className="scroll">
      <table className="checks">
        <thead>
          <tr>
            <th>position group</th>
            <th>spread within a player</th>
            <th>spread between players</th>
            <th>k, plays of prior weight</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(meta.shrink).map(([grp, s]) => (
            <tr key={grp}>
              <td>{grp}</td>
              <td>{Math.sqrt(s.within).toFixed(2)}</td>
              <td>{Math.sqrt(s.between).toFixed(2)}</td>
              <td>{s.k.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <h2>What it is not</h2>
      <ul>
        <li>Not a coverage grade: the model is told where and when the ball will land before the defender moves.</li>
        <li>Not an outcome stat: across players it does not predict completions or EPA, the correlations are under 0.1.</li>
        <li>Not the whole job: anticipation before the throw is already inside the expectation and gets no credit.</li>
        <li>Not free of team: a team's scheme and its players cannot be separated with one season, so team context is inside every number.</li>
        <li>Not exact units: the model's spread is about fifteen percent too narrow, so the scale is consistent but not calibrated.</li>
        <li>Not the same model as the what if tool: the replay's expected paths come from the fold that never saw the game, the tool asks the published model.</li>
      </ul>
      <p>
        The model behind all of this holds an error of {le40 ? le40.mean.toFixed(3) : "?"} yards on plays of forty
        frames or fewer, against 1.61 yards for assuming everyone keeps running in a straight line. Data generated{" "}
        {meta.generated}. Code and method at <a href="https://github.com/Rishi180303/keys">github.com/Rishi180303/keys</a>.
      </p>
      <h2>The replays</h2>
      <p>
        Players move exactly as the tracking data has them, ten frames a second, and the air time plays at a little over
        half speed. The data does not track the ball, so its flight is drawn: a straight line from the passer at the
        throw to the landing spot, with an arc for height. The dashed line is where the model expected the featured
        defender to go, and the ring around its end is the model's spread.
      </p>
      <h2 id="photos">Photo credits</h2>
      <p>
        Player photos come from Wikimedia Commons, matched to each defender on Wikidata by name and birth date, and only
        under licenses that allow reuse with credit (CC BY, CC BY-SA, CC0 or public domain). A defender without one gets
        a badge in his team's color. No photo here is an NFL headshot.
      </p>
      <Credits />
    </article>
  );
}
