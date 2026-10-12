import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { loadMeta } from "../lib/data";
import { label } from "../lib/format";
import type { Cell, Meta } from "../lib/types";
import { Stat, useTitle } from "../ui";

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
  "not catchable": "the receiver ended more than four yards from the landing spot",
  "over 40 frames": "the ball was in the air longer than four seconds",
};
const signed = (v: number | null, d = 3) => (v === null ? "" : (v < 0 ? "−" : "+") + Math.abs(v).toFixed(d));
const num = (v: number | null, d: number) => (v === null ? "unknown" : v.toFixed(d));

export default function How() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { hash } = useLocation();
  useTitle("How it works");
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
      <header className="how-head">
        <h1>How the rating works</h1>
        <p className="lead">
          On every pass, a model guesses where each defender should end up when the ball lands. The rating is how much
          better he did than that guess.
        </p>
      </header>

      <ol className="steps">
        <li>
          <span className="step-n">1</span>
          <h2>The throw</h2>
          <p>
            The NFL tracks every player ten times a second. The moment the ball leaves the quarterback's hand, the model
            is shown the last two seconds of movement, where the ball will come down, and how long it will take to get
            there.
          </p>
        </li>
        <li>
          <span className="step-n">2</span>
          <h2>The guess</h2>
          <p>
            It answers with where it expects the receiver and the nearest defenders to be when the ball arrives, and
            how sure it is about each one.
          </p>
        </li>
        <li>
          <span className="step-n">3</span>
          <h2>The score</h2>
          <p>
            When the ball lands, I measure how much closer the defender got than the model expected, along the line to
            the ball. A sure guess counts for more than a coin flip. His rating is the average over his plays, pulled
            toward zero if he has only a few.
          </p>
        </li>
      </ol>

      <div className="stats how-stats">
        <Stat value={g.rows.rated.toLocaleString()} label="plays rated" />
        <Stat value={String(g.rows.players_listed)} label="defenders listed" />
        <Stat value={le40 ? le40.mean.toFixed(2) : "?"} label="model error, yards" />
        <Stat value="1.61" label="straight line guess, yards" />
      </div>

      <section className="how-grid">
        <div className="how-card">
          <h2>What it measures</h2>
          <ul>
            <li>Pursuit after the throw. Nothing before it.</li>
            <li>Each play is judged against the same kind of throw, route, role and position, so a safety on deep balls and a slot corner on screens each get a fair comparison.</li>
            <li>Every rating comes with a range. I only call a player above or below average when that range clears zero.</li>
          </ul>
        </div>
        <div className="how-card">
          <h2>What it is not</h2>
          <ul>
            <li>Not a coverage grade. The model already knows where the ball lands, so reading the play early earns no credit here.</li>
            <li>Not an outcome stat. It does not predict completions or EPA. The leaderboard shows those next to it so you can see that for yourself.</li>
            <li>Not free of team. One season cannot tell a scheme apart from its players.</li>
            <li>Not exact units. The model's spread runs about fifteen percent too narrow, so the scale is consistent but not calibrated.</li>
          </ul>
        </div>
      </section>

      <details className="how-more" id="checks">
        <summary>The checks before a run is published</summary>
        <p>
          A rating that mostly measures scheme is not a rating. So before anything goes live, run {meta.run} had to pass
          four checks. No situation may move the average by more than {num(g.limit, 3)} (a quarter of the spread between
          players). A defender's number in even numbered games has to line up with his number in odd numbered games
          (correlation {num(g.reliability.r, 2)} over {g.reliability.players} players, 0.40 required). The league mean
          has to sit at zero. And fewer than fifteen percent of plays may be left out. This run{" "}
          {g.passed ? "passed" : "failed"}.
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
        <p className="caption">
          Air time, role, position and route sit near zero because they are centered out. Coverage, man or zone, and
          starting distance are the live checks. Pass result and team are reported but never gated:{" "}
          {Object.entries(g.info)
            .map(([dim, cells]) => `${dim === "result" ? "pass result" : "team"} runs from ${signed(Math.min(...cells.map((c) => c.mean)), 2)} to ${signed(Math.max(...cells.map((c) => c.mean)), 2)}`)
            .join("; ")}
          .
        </p>
      </details>

      <details className="how-more" id="plays">
        <summary>Which plays count</summary>
        <p>
          {g.rows.flagged.toLocaleString()} flagged defender plays, {g.rows.rated.toLocaleString()} rated. A defender
          needs {meta.min_plays} rated plays to be listed. A play is left out when
        </p>
        <ul>
          {Object.entries(g.excluded.by_reason).map(([reason, n]) => (
            <li key={reason}>
              {REASONS[reason] ?? reason}: {n.toLocaleString()} plays
            </li>
          ))}
        </ul>
      </details>

      <details className="how-more" id="shrinkage">
        <summary>Shrinkage, by position</summary>
        <p>
          A player with few plays cannot top the list on luck. His rating is pulled toward zero by k plays of prior
          weight, set per position from how much ratings vary within a player against between players.
        </p>
        <div className="scroll">
          <table className="checks">
            <thead>
              <tr>
                <th>position group</th>
                <th>spread within a player</th>
                <th>spread between players</th>
                <th>k</th>
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
      </details>

      <details className="how-more" id="replays">
        <summary>How the replays are drawn</summary>
        <p>
          Players move exactly as the tracking data has them, ten frames a second, and the ball's flight plays at a
          little over half speed. The data does not track the ball, so its path is drawn as a straight line from the
          passer to the landing spot with an arc for height. The dashed line is where the model expected the featured
          defender to go, and the ring at its end is how sure it was. The what if tool asks the published model; the
          replay's expected path comes from the fold that never saw that game, so the two can differ a little.
        </p>
      </details>

      <p className="how-foot">
        Run {meta.run}, data generated {meta.generated}. Code and method at{" "}
        <a href="https://github.com/Rishi180303/keys">github.com/Rishi180303/keys</a>.
      </p>
    </article>
  );
}
