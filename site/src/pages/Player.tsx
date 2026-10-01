import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { label, outcome, pct, rankText, signed } from "../lib/format";
import { loadGame, loadMeta, loadPhotos, loadPlays } from "../lib/data";
import { board, mainTeam } from "../lib/people";
import { rated, ratePlayers } from "../lib/rating";
import { teamName } from "../lib/teams";
import type { Game, Meta, Photos, PlayRow } from "../lib/types";
import Replay from "../replay/Replay";
import { buildScene } from "../replay/scene";
import { Avatar, Meter, ReplayWait, Stat, TierChip } from "../ui";

export default function Player() {
  const id = Number(useParams().id);
  const [season, setSeason] = useState<{ rows: PlayRow[]; meta: Meta } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photos | null>(null);
  const [at, setAt] = useState(0);
  const [game, setGame] = useState<Game | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    Promise.all([loadPlays(), loadMeta()])
      .then(([rows, meta]) => setSeason({ rows, meta }))
      .catch((e: Error) => setError(e.message));
    loadPhotos().then(setPhotos);
  }, []);
  useEffect(() => setAt(0), [id]);

  // everyone gets a card, but only a listed defender gets a rank in his group
  const me = useMemo(() => {
    if (!season) return null;
    const mine = rated(season.rows).filter((r) => r.id === id);
    const p = ratePlayers(mine, season.meta.shrink, 1)[0];
    if (!p) return null;
    const group = board(season.rows, season.meta, p.grp);
    const rank = group.findIndex((q) => q.id === id) + 1;
    return { p, rank, total: group.length };
  }, [season, id]);

  const plays = me?.p.plays ?? [];
  const current = plays[at] ?? null;

  // the reel's play: its game file, then the next one, so the reel does not stall between plays
  useEffect(() => {
    if (!current) return;
    let stale = false;
    setGame(null);
    setGameError(null);
    loadGame(current.game)
      .then((g) => !stale && setGame(g))
      .catch((e: Error) => !stale && setGameError(`This play did not load (${e.message}).`));
    const next = plays[at + 1];
    if (next) loadGame(next.game).catch(() => {});
    return () => {
      stale = true;
    };
  }, [current, plays, at, tries]);

  const scene = useMemo(() => {
    const play = game && current ? game.plays.find((q) => q.play === current.play) : null;
    return play ? buildScene(play, id) : null;
  }, [game, current, id]);

  if (error) return <p className="page-msg">The season did not load ({error}).</p>;
  if (!season) return <p className="page-msg quiet">Loading the player</p>;
  if (!me) return <p className="page-msg">No rated defender has the id {id}.</p>;
  const { p, rank, total } = me;
  const team = mainTeam(p);
  const photo = photos?.[String(p.id)];

  return (
    <div className="player">
      <section className="pcard" aria-label="season card">
        <div className="pcard-top">
          <Avatar id={p.id} name={p.name} team={team} photos={photos} size={112} square />
          <div>
            <h1>{p.name}</h1>
            <p className="pmeta">
              {p.pos}, {p.teams.length ? p.teams.map((t) => teamName(t.team)).join(" and ") : teamName(team)}
            </p>
            <p className="prank">{rank ? rankText(rank, total, p.grp) : `Not listed, fewer than ${season.meta.min_plays} rated plays`}</p>
          </div>
        </div>
        {photo && (
          <p className="credit">
            Photo: {photo.artist},{" "}
            {photo.license_url ? <a href={photo.license_url}>{photo.license}</a> : photo.license},{" "}
            <a href={photo.source}>Wikimedia Commons</a>
          </p>
        )}
        <div className="pnum">
          <b className={p.tier}>{signed(p.rating)}</b>
          <TierChip tier={p.tier} />
        </div>
        <Meter rating={p.rating} se={p.se} />
        <p className="pnote">
          Closing over expected, with its range of plus or minus two standard errors on a scale from −1 to +1.
        </p>
        <div className="stats">
          <Stat value={String(p.n)} label="rated plays" />
          <Stat value={signed(p.yards)} label="yards closer" />
          <Stat value={pct(p.comp)} label="completion rate" />
          <Stat value={p.epa === null ? "none" : signed(p.epa)} label="EPA per play" />
        </div>
      </section>

      <section className="preel" aria-label="his plays">
        {scene ? (
          <Replay scene={scene} onEnd={() => setAt((i) => (i + 1 < plays.length ? i + 1 : 0))} />
        ) : (
          <ReplayWait error={gameError} onRetry={() => setTries((n) => n + 1)} />
        )}
        <h2>
          His {plays.length} rated plays, best first
        </h2>
        <ol className="plist">
          {plays.map((r, i) => (
            <li key={`${r.game}-${r.play}`} className={i === at ? "on" : ""}>
              <button type="button" onClick={() => setAt(i)} aria-current={i === at}>
                <span className="pl-week">Week {r.week}</span>
                <span className="pl-what">
                  {label(r.route)} route, {outcome(r.result)}
                </span>
                <span className="pl-yd">{signed(r.yards)} yd</span>
                <span className="pl-zc">{signed(r.zc)}</span>
              </button>
              <Link to={`/play/${r.game}/${r.play}?d=${p.id}`} aria-label={`open week ${r.week} play`}>
                Open
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
