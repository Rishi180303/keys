import type { Scene } from "./scene";

/** Frames shown before the throw, the tracking rate, the slow motion rate in the air and the hold at arrival. */
export const LEAD_FRAMES = 22;
export const FPS = 10;
export const AIR_RATE = 0.6;
export const HOLD = 2.6;

export type Timeline = {
  /** the first frame the replay shows */
  start: number;
  throwFrame: number;
  arriveFrame: number;
  /** seconds from the start of the replay */
  tThrow: number;
  tArrive: number;
  duration: number;
  frameAt: (t: number) => number;
  timeAt: (frame: number) => number;
};

/** Wall clock seconds to a fractional frame: the lead in at real speed, the air at AIR_RATE, then HOLD seconds on the
 * arrival frame. speed (1 or 0.5) scales everything but the hold. */
export function makeTimeline(scene: Scene, speed = 1): Timeline {
  const throwFrame = scene.nIn - 1;
  const arriveFrame = scene.frames - 1;
  const start = Math.max(0, throwFrame - LEAD_FRAMES);
  const lead = FPS * speed;
  const air = FPS * AIR_RATE * speed;
  const tThrow = (throwFrame - start) / lead;
  const tArrive = tThrow + scene.nfo / air;
  return {
    start,
    throwFrame,
    arriveFrame,
    tThrow,
    tArrive,
    duration: tArrive + HOLD,
    frameAt: (t) => (t <= 0 ? start : t < tThrow ? start + t * lead : t < tArrive ? throwFrame + (t - tThrow) * air : arriveFrame),
    timeAt: (frame) => {
      const f = Math.min(arriveFrame, Math.max(start, frame));
      return f <= throwFrame ? (f - start) / lead : tThrow + (f - throwFrame) / air;
    },
  };
}

/** The time one whole frame before or after t, for stepping with the arrow keys. From the arrival frame a step
 * forward goes to the end of the hold, where the caption shows; from the hold a step back goes to the frame before
 * arrival. */
export function stepFrame(tl: Timeline, t: number, dir: 1 | -1): number {
  if (dir > 0 && t >= tl.tArrive - 1e-9) return tl.duration;
  if (dir < 0 && t > tl.tArrive + 1e-9) return tl.timeAt(tl.arriveFrame - 1);
  const f = tl.frameAt(t);
  const next = dir > 0 ? Math.floor(f + 1e-9) + 1 : Math.ceil(f - 1e-9) - 1;
  return tl.timeAt(next);
}
