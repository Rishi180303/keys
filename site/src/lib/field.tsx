import { useRef, useState, type PointerEvent } from "react";
import type { Prediction } from "./api";
import type { GamePlayer, Play } from "./types";

export const FIELD_X = 120;
export const FIELD_Y = 53.3;
/** The model predicts forty frames; anything past that is the frame forty prediction held still. */
export const HORIZON = 40;

/** Where a player is at frame t: his input frames, then his actual frames if he was predicted, else held. */
export function positionAt(p: GamePlayer, t: number): [number, number] {
  const n = p.in.length;
  if (t < n) return [p.in[t][0], p.in[t][1]];
  if (p.out && p.out.length) {
    const k = Math.min(t - n, p.out.length - 1);
    return [p.out[k][0], p.out[k][1]];
  }
  return [p.in[n - 1][0], p.in[n - 1][1]];
}

export function inputFrames(play: Play): number {
  return Math.max(...play.players.map((p) => p.in.length));
}

export function frameCount(play: Play): number {
  return inputFrames(play) + play.nfo;
}

const points = (pts: number[][]) => pts.map(([x, y]) => `${x},${y}`).join(" ");
const last = (p: GamePlayer) => p.in[p.in.length - 1];

type Props = {
  play: Play;
  t: number;
  land: [number, number];
  whatIf?: Prediction | null;
  /** When given, the landing marker can be dragged and this receives the spot on drop. */
  onLand?: (xy: [number, number]) => void;
};

export default function Field({ play, t, land, whatIf, onLand }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const toField = (e: PointerEvent<SVGElement>): [number, number] => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    const clamp = (v: number, hi: number) => Math.min(Math.max(v, -5), hi + 5);
    return [Math.round(clamp(pt.x, FIELD_X) * 100) / 100, Math.round(clamp(pt.y, FIELD_Y) * 100) / 100];
  };
  const drop = () => {
    if (drag && onLand) onLand(drag);
    setDrag(null);
  };
  const whatIfPaths = new Map<number, number[][]>();
  for (const q of [...(whatIf?.predictions ?? [])].sort((a, b) => a.frame_id - b.frame_id)) {
    const list = whatIfPaths.get(q.nfl_id);
    if (list) list.push([q.x, q.y]);
    else whatIfPaths.set(q.nfl_id, [[q.x, q.y]]);
  }
  const marker = drag ?? land;
  return (
    <svg
      ref={svg}
      className="field"
      viewBox={`-6 -6 ${FIELD_X + 12} ${FIELD_Y + 12}`}
      onPointerMove={(e) => drag && setDrag(toField(e))}
      onPointerUp={drop}
      onPointerLeave={drop}
    >
      <rect x={0} y={0} width={FIELD_X} height={FIELD_Y} className="turf" />
      <rect x={0} y={0} width={10} height={FIELD_Y} className="endzone" />
      <rect x={110} y={0} width={10} height={FIELD_Y} className="endzone" />
      {Array.from({ length: 21 }, (_, i) => 10 + i * 5).map((x) => (
        <line key={x} x1={x} y1={0} x2={x} y2={FIELD_Y} className={x % 10 === 0 ? "yard10" : "yard5"} />
      ))}
      {play.players.map(
        (p) => p.out && <polyline key={`a${p.id}`} className="actual" points={points([last(p), ...p.out])} />,
      )}
      {play.players.map((p) => {
        if (!p.pred || !p.pred.length) return null;
        const path = p.pred.slice(0, HORIZON);
        const end = path[path.length - 1];
        return (
          <g key={`e${p.id}`}>
            <polyline className="expected" points={points([last(p), ...path])} />
            <ellipse className="spread" cx={end[0]} cy={end[1]} rx={end[2]} ry={end[3]} />
          </g>
        );
      })}
      {[...whatIfPaths].map(([id, pts]) => {
        const p = play.players.find((q) => q.id === id);
        return p && <polyline key={`w${id}`} className="whatif" points={points([last(p), ...pts.slice(0, HORIZON)])} />;
      })}
      {play.players.map((p) => {
        const [x, y] = positionAt(p, t);
        const held = t >= p.in.length && !p.out;
        const cls = ["player", p.side === "Offense" ? "offense" : "defense", p.p ? "predicted" : "", p.role === "Targeted Receiver" ? "target" : "", held ? "held" : ""];
        return (
          <g key={p.id} className={cls.join(" ")}>
            <circle cx={x} cy={y} r={0.9} />
            {p.p && (
              <text x={x} y={y - 1.4} textAnchor="middle">
                {p.name.split(" ").slice(-1)[0]}
              </text>
            )}
            <title>
              {p.name}, {p.pos}
            </title>
          </g>
        );
      })}
      <g
        className={`land ${onLand ? "draggable" : ""}`}
        onPointerDown={(e) => {
          if (!onLand) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(toField(e));
        }}
      >
        <circle cx={marker[0]} cy={marker[1]} r={3} className="landhit" />
        <path
          d={`M ${marker[0] - 1} ${marker[1]} L ${marker[0]} ${marker[1] - 1} L ${marker[0] + 1} ${marker[1]} L ${marker[0]} ${marker[1] + 1} Z`}
        />
      </g>
    </svg>
  );
}
