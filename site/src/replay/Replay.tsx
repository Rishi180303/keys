import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { blend, camera as viewOf, CAMERAS, defaultCamera, ease, screenNudge, type CameraName, type Viewport } from "./cameras";
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
/** how long a switch between cameras glides, in milliseconds */
const GLIDE = 600;

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

const ids = new WeakMap<Scene, number>();
let lastId = 0;
const idOf = (s: Scene) => ids.get(s) ?? (ids.set(s, ++lastId), lastId);

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 10 < 4 && Math.floor(n / 10) !== 1 ? n % 10 : 0]}`;
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const where = ([l, u]: Pt) => `${u.toFixed(1)} yards downfield, ${l.toFixed(1)} from the left sideline`;

/** A play as a cinematic replay on a canvas, with its controls and its arrival caption. */
export default function Replay({ scene, camera: forced = null, autoplay = true, loop = false, onEnd, whatIf = null }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [size, setSize] = useState<Viewport>({ w: 0, h: 0 });
  const [speed, setSpeed] = useState<1 | 0.5>(1);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const tl = useMemo(() => makeTimeline(scene, speed), [scene, speed]);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [tabShown, setTabShown] = useState(() => typeof document === "undefined" || !document.hidden);
  const [pick, setPick] = useState<CameraName | null>(readPick);
  const [drag, setDrag] = useState<Pt | null>(null);
  const [said, setSaid] = useState("");
  const [fontTick, setFontTick] = useState(0);
  const [glide, setGlide] = useState<{ from: CameraName; at: number } | null>(null);
  const [, setGlideTick] = useState(0);
  const cam: CameraName = forced ?? pick ?? defaultCamera(size.w && size.h ? size : { w: 16, h: 9 });
  const shownCam = useRef(cam);
  const editing = !!whatIf && cam === "overhead";
  const visible = onScreen && tabShown;

  const seek = (next: number) => {
    tRef.current = next;
    setT(next);
  };

  // a new play starts from the top, or paused in the arrival hold, caption up, for people who asked for less motion
  useEffect(() => {
    const calm = reduced();
    const first = makeTimeline(scene, speedRef.current);
    seek(calm ? Math.min(first.duration, first.tArrive + 1) : 0);
    setPlaying(autoplay && !calm);
    setDrag(null);
  }, [scene, autoplay]);

  // size, whether the replay is on screen, and whether the tab is showing: it only plays when both are true
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    const io = new IntersectionObserver((entries) => setOnScreen(entries[entries.length - 1].isIntersecting));
    io.observe(el);
    const onVis = () => setTabShown(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // the display font may arrive after the first frames; draw again when it does
  useEffect(() => {
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts) return;
    const bump = () => setFontTick((n) => n + 1);
    fonts.ready.then(bump);
    fonts.addEventListener("loadingdone", bump);
    return () => fonts.removeEventListener("loadingdone", bump);
  }, []);

  // a camera switch glides from the old view to the new one
  useEffect(() => {
    if (shownCam.current !== cam && size.w) setGlide({ from: shownCam.current, at: performance.now() });
    shownCam.current = cam;
  }, [cam, size.w]);
  useEffect(() => {
    if (!glide) return;
    let raf = 0;
    const tick = (now: number) => {
      if (now - glide.at >= GLIDE) setGlide(null);
      else {
        setGlideTick((n) => n + 1);
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [glide]);

  // the clock; a step never jumps more than a tenth of a second, so a tab left in the background resumes in place
  useEffect(() => {
    if (!playing || !visible) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      let next = tRef.current + Math.min(0.1, Math.max(0, (now - last) / 1000));
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

  const ready = size.w > 0 && size.h > 0;
  const frame = tl.frameAt(t);
  const spot = whatIf?.land ?? null;
  const target = ready ? viewOf(cam, scene, frame, size, cam === "overhead" ? spot : null) : null;
  const k = glide ? Math.min(1, (performance.now() - glide.at) / GLIDE) : 1;
  const view = target && glide && k < 1 ? blend(viewOf(glide.from, scene, frame, size, glide.from === "overhead" ? spot : null), target, ease(k)) : target;

  // draw
  useEffect(() => {
    const el = canvas.current;
    if (!el || !view) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (el.width !== Math.round(size.w * dpr) || el.height !== Math.round(size.h * dpr)) {
      el.width = Math.round(size.w * dpr);
      el.height = Math.round(size.h * dpr);
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrame(ctx, scene, view, frame, size, NIGHT, {
      start: tl.start,
      arrive: Math.min(1, Math.max(0, (t - tl.tArrive) / 0.5)),
      whatIf: whatIf?.paths ?? null,
      land: drag ?? spot,
      editing,
    });
  });

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

  // the landing ring's handle: a small target over the ring, the only part of the stage that takes touches
  const ring = editing && view && spot ? view.project(...(drag ?? spot)) : null;
  const toGround = (e: PointerEvent<HTMLElement>): Pt | null => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r || !view?.unproject) return null;
    const [l, u] = view.unproject(e.clientX - r.left, e.clientY - r.top);
    // stay on screen: the view reframes around the spot once it is dropped
    return clampLand(scene, [Math.min(55.3, Math.max(-2, l)), Math.min(view.uMax - 1, Math.max(view.uMin + 1, u))]);
  };
  const ringDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!spot) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(spot);
  };
  const ringMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = drag && toGround(e);
    if (p) setDrag(p);
  };
  const ringUp = () => {
    if (drag && whatIf) whatIf.onLand(drag);
    setDrag(null);
  };
  const ringKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!whatIf || !view || e.altKey || e.ctrlKey || e.metaKey) return;
    const next = screenNudge(view, whatIf.land, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    const p = clampLand(scene, next);
    whatIf.onLand(p);
    setSaid(`landing spot moved to ${where(p)}`);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    // the scrubber handles its own keys, and space presses a focused button
    if (tag === "INPUT" || (e.key === " " && tag === "BUTTON")) return;
    if (e.key === " ") {
      e.preventDefault();
      toggle();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
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
  const speedText = speed === 1 ? "1×" : "½×";

  return (
    <div className="rp" role="region" tabIndex={0} onKeyDown={onKey} aria-label="play replay; space plays and pauses, the arrow keys step a frame">
      <div className="rp-stage" ref={wrap}>
        <canvas ref={canvas} role="img" aria-label={summary} data-font={fontTick} />
        {ring && spot && (
          <button
            type="button"
            className="rp-ring"
            style={{ left: ring[0], top: ring[1] }}
            aria-label={`landing spot, ${where(drag ?? spot)}; drag it or use the arrow keys`}
            onPointerDown={ringDown}
            onPointerMove={ringMove}
            onPointerUp={ringUp}
            onPointerCancel={ringUp}
            onKeyDown={ringKey}
          />
        )}
        <span className="rp-sr" aria-live="polite">
          {said}
        </span>
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
          <div key={idOf(scene)} className={`rp-cap ${showCap ? "on" : ""}`} aria-hidden={!showCap}>
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
        <button type="button" className="rp-speed" onClick={changeSpeed} aria-pressed={speed === 0.5} aria-label={`${speedText} speed`}>
          {speedText}
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
