import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { loadMeta, loadPlays } from "../lib/data";
import { applyFilters, rated, ratePlayers, type Filters } from "../lib/rating";
import type { Meta, PlayRow } from "../lib/types";

const GROUPS = ["CB", "S", "LB"] as const;
export const signed = (v: number, d = 2) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(d);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();

/** The rating with its interval, rating plus or minus two standard errors, on a fixed scale from -1 to +1. */
function Bar({ rating, se }: { rating: number; se: number }) {
  const x = (v: number) => Math.min(100, Math.max(0, (v + 1) * 50));
  const lo = x(rating - 2 * se);
  return (
    <span className="bar" aria-hidden="true">
      <span className="zero" />
      <span className="interval" style={{ left: `${lo}%`, width: `${x(rating + 2 * se) - lo}%` }} />
      <span className="point" style={{ left: `${x(rating)}%` }} />
    </span>
  );
}

export default function Leaderboard() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<PlayRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ grp: "CB", cov: "any", route: "any", role: "any", team: "any", minPlays: 30 });
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([loadMeta(), loadPlays()])
      .then(([m, r]) => {
        setMeta(m);
        setRows(rated(r));
        setFilters((f) => ({ ...f, minPlays: m.min_plays }));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const options = useMemo(() => {
    const uniq = (k: "cov" | "route" | "team") => [...new Set((rows ?? []).map((r) => r[k]))].sort();
    return { cov: uniq("cov"), route: uniq("route"), team: uniq("team") };
  }, [rows]);
  const players = useMemo(
    () => (rows && meta ? ratePlayers(applyFilters(rows, filters), meta.shrink, filters.minPlays) : []),
    [rows, meta, filters],
  );

  if (error) return <p className="error">{error}</p>;
  if (!rows || !meta) return <p className="loading">loading the season</p>;
  const set = (patch: Partial<Filters>) => {
    setFilters({ ...filters, ...patch });
    setOpen(null);
  };
  const k = meta.shrink[filters.grp]?.k;

  return (
    <section>
      <h1>closing over expected</h1>
      <p className="lede">
        Knowing where and when the ball came down, the model predicts where a typical defender would be at the catch
        point from this player's spot at the throw. The rating is how much closer he actually got, in units of the
        model's own spread, compared with defenders in the same situation, averaged over his plays. It is a movement
        stat and says nothing about whether the pass was caught. <Link to="/about">How it is computed and checked.</Link>
      </p>
      <div className="tabs" role="tablist">
        {GROUPS.map((g) => (
          <button key={g} role="tab" aria-selected={filters.grp === g} className={filters.grp === g ? "on" : ""} onClick={() => set({ grp: g })}>
            {g}
          </button>
        ))}
      </div>
      <div className="filters">
        <label>
          coverage
          <select value={filters.cov} onChange={(e) => set({ cov: e.target.value })}>
            <option value="any">any</option>
            <option value="man">man</option>
            <option value="zone">zone</option>
            {options.cov.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          route
          <select value={filters.route} onChange={(e) => set({ route: e.target.value })}>
            <option value="any">any</option>
            {options.route.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
        <label>
          role
          <select value={filters.role} onChange={(e) => set({ role: e.target.value })}>
            <option value="any">any</option>
            <option value="primary">primary, closest expected to the ball</option>
            <option value="help">help</option>
          </select>
        </label>
        <label>
          team
          <select value={filters.team} onChange={(e) => set({ team: e.target.value })}>
            <option value="any">any</option>
            {options.team.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          at least
          <input
            type="number"
            min={1}
            value={filters.minPlays}
            onChange={(e) => set({ minPlays: Math.max(1, Number(e.target.value) || 1) })}
          />
          plays
        </label>
      </div>
      <div className="scroll">
      <table className="board">
        <thead>
          <tr>
            <th>player</th>
            <th>teams</th>
            <th>plays</th>
            <th>rating</th>
            <th>tier</th>
            <th>yards closer</th>
            <th>completion rate</th>
            <th>EPA per play</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <Fragment key={p.id}>
              <tr className={`row ${p.tier}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                <td>
                  <button
                    type="button"
                    className="expand"
                    aria-expanded={open === p.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(open === p.id ? null : p.id);
                    }}
                  >
                    {p.name}
                  </button>{" "}
                  <span className="pos">{p.pos}</span>
                </td>
                <td>{p.teams.map((t) => t.team).join(", ")}</td>
                <td>{p.n}</td>
                <td className="rating">
                  {signed(p.rating)} <Bar rating={p.rating} se={p.se} />
                </td>
                <td>
                  <span className={`tier ${p.tier}`}>{p.tier}</span>
                </td>
                <td>{signed(p.yards)}</td>
                <td>{pct(p.comp)}</td>
                <td>{p.epa === null ? "" : signed(p.epa)}</td>
              </tr>
              {open === p.id && (
                <tr className="plays">
                  <td colSpan={8}>
                    <table>
                      <tbody>
                        {p.plays.map((r) => (
                          <tr key={`${r.game}-${r.play}`}>
                            <td>week {r.week}</td>
                            <td>{r.team}</td>
                            <td>{label(r.cov)}</td>
                            <td>{label(r.route)}</td>
                            <td>{r.role}</td>
                            <td>{r.result === "C" ? "complete" : r.result === "I" ? "incomplete" : "intercepted"}</td>
                            <td>{signed(r.yards)} yd</td>
                            <td>{signed(r.zc)}</td>
                            <td>
                              <Link to={`/play/${r.game}/${r.play}`}>watch</Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      </div>
      <p className="caption">
        {players.length} {filters.grp} with at least {filters.minPlays} rated plays. The rating is the mean of the
        per play values, shrunk toward zero with k of {k === undefined ? "?" : k.toFixed(0)} plays for this position.
        The bar is the rating plus or minus two standard errors on a scale from minus one to plus one; above and
        below mean that interval clears zero. Completion rate and EPA are what happened on the same plays; the rating
        does not predict either. Click a row for the plays.
      </p>
    </section>
  );
}
