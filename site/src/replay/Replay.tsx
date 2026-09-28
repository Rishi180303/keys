import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { camera as viewOf, CAMERAS, defaultCamera, screenNudge, type CameraName, type View, type Viewport } from "./cameras";
import { caption } from "./captions";
import { drawFrame, NIGHT } from "./draw";
import type { Pt, Scene } from "./scene";
import { makeTimeline, stepFrame } from "./timeline";
import { clampLand } from "./whatif";
import "./replay.css";

export type WhatIf = { land: Pt; paths: Map<number, Pt[]> | null; onLand: (p: Pt) => void };

type Props = {
  scene: Scene;
  /** a camera the page forces, like overhead for the what if; otherwise the viewer's pick, else the default */
  camera?: CameraName | null;
  autoplay?: boolean;
  loop?: boolean;
  /** called when the replay finishes, instead of stopping on the arrival frame */
  onEnd?: () => void;
  whatIf?: WhatIf | null;
};

const STORE = "keys.camera";
const LABELS: Record<CameraName, string> = { broadcast: "Broadcast", overhead: "Overhead", chase: "Chase" };

function readPick(): CameraName | null {
  try {
    const v = localStorage.getItem(STORE);
    return CAMERAS.includes(v as CameraName) ? (v as CameraName) : null;
  } catch {
    return null;
  }
}

function savePick(c: CameraName) {
  try {
    localStorage.setItem(STORE, c);
  } catch {
    // private windows can refuse storage; the pick just lasts for this page
  }
}

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 10 < 4 && Math.floor(n / 10) !== 1 ? n % 10 : 0]}`;
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A play as a cinematic replay on a canvas, with its controls and its arrival caption. */
export default function Replay({ scene, camera: forced = null, autoplay = true, loop = false, onEnd, whatIf = null }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View | null>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [size, setSize] = useState<Viewport>({ w: 0, h: 0 });
  const [speed, setSpeed] = useState<1 | 0.5>(1);
  const tl = useMemo(() => makeTimeline(scene, speed), [scene, speed]);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pick, setPick] = useState<CameraName | null>(readPick);
  const [drag, setDrag] = useState<Pt | null>(null);
  const cam: CameraName = forced ?? pick ?? defaultCamera(size.w && size.h ? size : { w: 16, h: 9 });
  const editing = !!whatIf && cam === "overhead";

  const seek = (next: number) => {
    tRef.current = next;
    setT(next);
  };

  // a new play starts from the top, or paused on arrival for people who asked for less motion
  useEffect(() => {
    const calm = reduced();
    const first = makeTimeline(scene, 1);
    seek(calm ? first.tArrive : 0);
    setPlaying(autoplay && !calm);
    setDrag(null);
  }, [scene, autoplay]);

  // size, and whether the replay is on screen at all
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && !document.hidden));
    io.observe(el);
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // the clock
  useEffect(() => {
    if (!playing || !visible) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      let next = tRef.current + (now - last) / 1000;
      last = now;
      if (next >= tl.duration) {
        if (loop) next = 0;
        else {
          seek(tl.duration);
          setPlaying(false);
          onEndRef.current?.();
          return;
        }
      }
      seek(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, visible, tl, loop]);

  // draw
  useEffect(() => {
    const el = canvas.current;
    if (!el || !size.w || !size.h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (el.width !== Math.round(size.w * dpr) || el.height !== Math.round(size.h * dpr)) {
      el.width = Math.round(size.w * dpr);
      el.height = Math.round(size.h * dpr);
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const frame = tl.frameAt(t);
    const v = viewOf(cam, scene, frame, size, !!whatIf);
    view.current = v;
    drawFrame(ctx, scene, v, frame, size, NIGHT, {
      start: tl.start,
      arrive: Math.min(1, Math.max(0, (t - tl.tArrive) / 0.5)),
      whatIf: whatIf?.paths ?? null,
      land: drag ?? whatIf?.land ?? null,
      editing,
    });
  }, [t, tl, cam, scene, size, whatIf, drag, editing]);

  const toggle = () => {
    if (!playing && tRef.current >= tl.duration - 1e-6) seek(0);
    setPlaying(!playing);
  };
  const changeSpeed = () => {
    const next = speed === 1 ? 0.5 : 1;
    // keep the same moment of the play
    seek(makeTimeline(scene, next).timeAt(tl.frameAt(tRef.current)) + (tRef.current > tl.tArrive ? tRef.current - tl.tArrive : 0));
    setSpeed(next);
  };
  const choose = (c: CameraName) => {
    setPick(c);
    savePick(c);
  };

  const local = (e: PointerEvent<HTMLCanvasElement>): Pt | null => {
    const r = e.currentTarget.getBoundingClientRect();
    return view.current?.unproject ? view.current.unproject(e.clientX - r.left, e.clientY - r.top) : null;
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!editing || !whatIf) return;
    const p = local(e);
    if (!p || Math.hypot(p[0] - whatIf.land[0], p[1] - whatIf.land[1]) > 4) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(clampLand(scene, p));
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = drag && local(e);
    if (p) setDrag(clampLand(scene, p));
  };
  const onUp = () => {
    if (drag && whatIf) whatIf.onLand(drag);
    setDrag(null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === " ") {
      e.preventDefault();
      toggle();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (editing && whatIf && view.current) {
      const next = screenNudge(view.current, whatIf.land, e.key, e.shiftKey);
      if (next) {
        e.preventDefault();
        whatIf.onLand(clampLand(scene, next));
      }
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setPlaying(false);
      seek(stepFrame(tl, tRef.current, e.key === "ArrowRight" ? 1 : -1));
    }
  };

  const p = scene.play;
  // the caption describes the real play, so it stays out of the way while exploring a what if
  const cap = whatIf ? null : caption(scene);
  const showCap = cap && t >= tl.tArrive + 0.15;
  const summary = `${p.off} pass, ${p.result === "C" ? "complete" : p.result === "I" ? "incomplete" : "intercepted"}. ${p.desc}${cap ? ` ${cap.who}: ${cap.kind === "rated" ? `${cap.yards} yards ${cap.line}` : cap.line}.` : ""}`;

  return (
    <div className="rp" tabIndex={0} onKeyDown={onKey} aria-label={`replay${editing ? ", arrow keys move the landing spot" : ", space plays and pauses, arrow keys step"}`}>
      <div className="rp-stage" ref={wrap}>
        <canvas ref={canvas} role="img" aria-label={summary} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className={editing ? "rp-editing" : ""} />
        <div className="rp-hud">
          <span>
            <b>
              Q{p.q} {p.clock}
            </b>{" "}
            · {ordinal(p.down)} &amp; {p.dist} · {p.off} ball
          </span>
          <span>
            {label(p.cov)} · {label(p.route)} route
          </span>
        </div>
        {cap && (
          <div className={`rp-cap ${showCap ? "on" : ""}`} aria-hidden={!showCap}>
            <div className="rp-who">{cap.who}</div>
            {cap.kind === "rated" ? (
              <>
                <div className="rp-big">
                  <span>{cap.yards}</span> yds
                </div>
                <div className="rp-line">{cap.line}</div>
              </>
            ) : (
              <div className="rp-line">{cap.line}</div>
            )}
          </div>
        )}
      </div>
      <div className="rp-controls">
        <button type="button" className="rp-play" onClick={toggle} aria-label={playing ? "pause" : "play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="rp-scrub">
          <input
            type="range"
            aria-label="replay time"
            min={0}
            max={tl.duration}
            step={0.01}
            value={Math.min(t, tl.duration)}
            onChange={(e) => {
              setPlaying(false);
              seek(Number(e.target.value));
            }}
          />
          <i className="rp-tick" style={{ left: `${(100 * tl.tThrow) / tl.duration}%` }} title="the throw" />
          <i className="rp-tick" style={{ left: `${(100 * tl.tArrive) / tl.duration}%` }} title="the ball arrives" />
        </div>
        <button type="button" className="rp-speed" onClick={changeSpeed} aria-pressed={speed === 0.5} aria-label="half speed">
          {speed === 1 ? "1×" : "½×"}
        </button>
        {!forced && (
          <div className="rp-cams" role="group" aria-label="camera">
            {CAMERAS.map((c) => (
              <button key={c} type="button" aria-pressed={cam === c} onClick={() => choose(c)}>
                {LABELS[c]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
