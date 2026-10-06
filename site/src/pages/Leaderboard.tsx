import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { loadMeta, loadPhotos, loadPlays } from "../lib/data";
import { groupName, label, pct, signed } from "../lib/format";
import { mainTeam } from "../lib/people";
import { applyFilters, rated, ratePlayers, rateTeams, tierOf, type Filters } from "../lib/rating";
import { badge, teamName } from "../lib/teams";
import type { Meta, Photos, PlayRow } from "../lib/types";
import { Avatar, Meter, TierChip, useTitle } from "../ui";

/** The tabs: one per position group, then every team's defenders together. */
const GROUPS = ["CB", "S", "LB", "teams"] as const;
const TAB_NAMES: Record<string, string> = { CB: "Corners", S: "Safeties", LB: "Linebackers", teams: "Teams" };

export default function Leaderboard() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<PlayRow[] | null>(null);
  const [photos, setPhotos] = useState<Photos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rest, setRest] = useState<Omit<Filters, "grp">>({ cov: "any", route: "any", role: "any", team: "any", minPlays: 30 });
  // the tab lives in the address, so Back from a player returns to the same tab
  const [query, setQuery] = useSearchParams();
  const grp = GROUPS.find((g) => g === query.get("grp")) ?? "CB";
  const filters: Filters = { ...rest, grp };
  const navigate = useNavigate();
  useTitle("Leaderboard");

  useEffect(() => {
    Promise.all([loadMeta(), loadPlays()])
      .then(([m, r]) => {
        setMeta(m);
        setRows(rated(r));
        setRest((f) => ({ ...f, minPlays: m.min_plays }));
      })
      .catch((e: Error) => setError(e.message));
    loadPhotos().then(setPhotos);
  }, []);

  const options = useMemo(() => {
    const uniq = (k: "cov" | "route" | "team") => [...new Set((rows ?? []).map((r) => r[k]))].sort();
    return { cov: uniq("cov"), route: uniq("route"), team: uniq("team") };
  }, [rows]);
  const teamView = filters.grp === "teams";
  const players = useMemo(
    () => (rows && meta && !teamView ? ratePlayers(applyFilters(rows, filters), meta.shrink, filters.minPlays) : []),
    [rows, meta, filters, teamView],
  );
  // the team view keeps the coverage, route, role and minimum plays filters and takes every position group together
  const teams = useMemo(
    () => (rows && teamView ? rateTeams(applyFilters(rows, { ...filters, grp: "any", team: "any" }), filters.minPlays) : []),
    [rows, filters, teamView],
  );

  if (error) return <p className="page-msg">The season did not load ({error}).</p>;
  if (!rows || !meta) return <p className="page-msg quiet">Loading the season</p>;
  const set = ({ grp: g, ...patch }: Partial<Filters>) => {
    if (g) setQuery(g === "CB" ? {} : { grp: g }, { replace: true });
    setRest({ ...rest, ...patch });
  };
  const k = meta.shrink[filters.grp]?.k;

  return (
    <div className="board-page">
      <header className="board-head">
        <h1>Leaderboard</h1>
        <p>
          How much closer to the catch point each defender got than the model expected, in the model's own units,
          averaged over his rated plays. It measures pursuit after the throw, not whether the pass was caught.{" "}
          <Link to="/how">How it is computed and checked</Link>
        </p>
      </header>
      <div className="tabs" role="tablist" aria-label="position group">
        {GROUPS.map((g) => (
          <button key={g} id={`tab-${g}`} type="button" role="tab" aria-selected={filters.grp === g} aria-controls="board-panel" onClick={() => set({ grp: g })}>
            {TAB_NAMES[g]}
          </button>
        ))}
      </div>
      <div className="filters">
        <label>
          Coverage
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
          Route
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
          Role
          <select value={filters.role} onChange={(e) => set({ role: e.target.value })}>
            <option value="any">any</option>
            <option value="primary">primary, closest expected to the ball</option>
            <option value="help">help</option>
          </select>
        </label>
        {!teamView && (
          <label>
            Team
            <select value={filters.team} onChange={(e) => set({ team: e.target.value })}>
              <option value="any">any</option>
              {options.team.map((t) => (
                <option key={t} value={t}>
                  {teamName(t)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          At least
          <input type="number" min={1} value={filters.minPlays} onChange={(e) => set({ minPlays: Math.max(1, Number(e.target.value) || 1) })} />
          {teamView ? "defender plays" : "plays"}
        </label>
      </div>

      <div role="tabpanel" id="board-panel" aria-labelledby={`tab-${filters.grp}`}>
      {teamView ? (
        <>
          <div className="scroll">
            <table className="board">
              <thead>
                <tr>
                  <th className="r">#</th>
                  <th>Team</th>
                  <th className="n">Defender plays</th>
                  <th>Rating</th>
                  <th>Tier</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t, i) => {
                  const tier = tierOf(t.mean, t.se);
                  return (
                    <tr key={t.team}>
                      <td className="r">{i + 1}</td>
                      <td>
                        <span className="who">
                          <span className="swatch" style={{ background: badge(t.team).bg }} aria-hidden="true" />
                          <b>{teamName(t.team)}</b>
                        </span>
                      </td>
                      <td className="n">{t.n}</td>
                      <td>
                        <span className="rating">
                          <span className={`num ${tier}`}>{signed(t.mean)}</span>
                          <Meter rating={t.mean} se={t.se} />
                        </span>
                      </td>
                      <td>
                        <TierChip tier={tier} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="caption">
            {teams.length} teams with at least {filters.minPlays} defender plays. A team's number is the plain mean of the
            per play values of its flagged defenders, every position together, on the plays the filters keep, with no
            shrinkage. The bar is that mean plus or minus two standard errors on a scale from minus one to plus one;
            above and below average mean that interval clears zero. A team's scheme and its players cannot be told apart
            in one season, so this is both.
          </p>
        </>
      ) : (
        <>
          <div className="scroll">
            <table className="board">
              <thead>
                <tr>
                  <th className="r">#</th>
                  <th>Player</th>
                  <th className="n">Plays</th>
                  <th>Rating</th>
                  <th>Tier</th>
                  <th className="n">Yards closer</th>
                  <th className="n">Completion rate</th>
                  <th className="n">EPA per play</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => (
                  <tr key={p.id} className="link-row" onClick={() => navigate(`/player/${p.id}`)}>
                    <td className="r">{i + 1}</td>
                    <td>
                      <span className="who">
                        <Avatar id={p.id} name={p.name} team={mainTeam(p)} photos={photos} size={32} />
                        <Link to={`/player/${p.id}`} onClick={(e) => e.stopPropagation()}>
                          <b>{p.name}</b>
                        </Link>
                        <span className="meta">
                          {p.pos} {p.teams.map((t) => t.team).join(" ")}
                        </span>
                      </span>
                    </td>
                    <td className="n">{p.n}</td>
                    <td>
                      <span className="rating">
                        <span className={`num ${p.tier}`}>{signed(p.rating)}</span>
                        <Meter rating={p.rating} se={p.se} />
                      </span>
                    </td>
                    <td>
                      <TierChip tier={p.tier} />
                    </td>
                    <td className="n">{signed(p.yards)}</td>
                    <td className="n">{pct(p.comp)}</td>
                    <td className="n">{p.epa === null ? "" : signed(p.epa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption">
            {players.length} {groupName(filters.grp)} with at least {filters.minPlays} rated plays. The rating is the mean
            of the per play values, shrunk toward zero with k of {k === undefined ? "?" : k.toFixed(0)} plays for this
            position. The bar is the rating plus or minus two standard errors on a scale from minus one to plus one;
            above and below average mean that interval clears zero. Completion rate and EPA are what happened on the
            same plays; the rating does not predict either.
          </p>
        </>
      )}
      </div>
    </div>
  );
}
