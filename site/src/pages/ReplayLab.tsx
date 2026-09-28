import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { apiRows, predict } from "../lib/api";
import { loadGame, loadMeta } from "../lib/data";
import type { Game, Meta } from "../lib/types";
import Replay, { type WhatIf } from "../replay/Replay";
import { buildScene, type Pt, type Scene } from "../replay/scene";
import { whatIfPaths } from "../replay/whatif";

/** Development only: any real play in the replay engine, wide or phone shaped, with the what if wired up. */
export default function ReplayLab() {
  const { game: g, play: pl } = useParams();
  const [game, setGame] = useState<Game | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tall, setTall] = useState(false);
  const [editing, setEditing] = useState(false);
  // the moved spot belongs to one scene, so a spot from the previous play never goes out with the next one
  const [moved, setMoved] = useState<{ scene: Scene; land: Pt } | null>(null);
  const [paths, setPaths] = useState<Map<number, Pt[]> | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    loadGame(Number(g)).then(setGame).catch((e: Error) => setStatus(e.message));
    loadMeta().then(setMeta).catch(() => {});
  }, [g]);
  const index = game ? game.plays.findIndex((p) => p.play === Number(pl)) : -1;
  const play = index >= 0 ? game!.plays[index] : null;
  const scene = useMemo(() => (play ? buildScene(play) : null), [play]);
  const land = moved && moved.scene === scene ? moved.land : null;
  useEffect(() => setPaths(null), [scene]);

  // like the play page: the request waits for the spot to settle for 300 ms, and a newer spot aborts an older request
  useEffect(() => {
    if (!scene || !land || !meta || !game || !play) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setStatus("asking the model");
      predict(meta.api_url, apiRows(game, play, scene.toField(land)), ctl.signal)
        .then((answer) => {
          setPaths(whatIfPaths(scene, answer));
          setStatus(`model ${answer.model}`);
        })
        .catch((e: Error) => !ctl.signal.aborted && setStatus(e.message));
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
      setStatus("");
    };
  }, [land, scene, meta, game, play]);

  if (!game || !scene) return <p>{status || "loading"}</p>;
  const whatIf: WhatIf | null = editing ? { land: land ?? scene.land, paths, onLand: (p) => setMoved({ scene, land: p }) } : null;
  const prev = game.plays[index - 1];
  const next = game.plays[index + 1];
  return (
    <section style={{ maxWidth: tall ? 390 : 1100 }}>
      <p>
        {prev && <Link to={`/lab/${game.game}/${prev.play}`}>previous</Link>} · {next && <Link to={`/lab/${game.game}/${next.play}`}>next</Link>} ·{" "}
        <button onClick={() => setTall(!tall)}>{tall ? "wide" : "phone shape"}</button>{" "}
        <button onClick={() => setEditing(!editing)}>{editing ? "leave what if" : "what if"}</button> {status}
      </p>
      <div style={tall ? ({ "--rp-aspect": "9 / 14" } as React.CSSProperties) : undefined}>
        <Replay scene={scene} loop={!editing} camera={editing ? "overhead" : null} whatIf={whatIf} />
      </div>
      <p>{play!.desc}</p>
    </section>
  );
}
