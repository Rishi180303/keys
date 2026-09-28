import type { Prediction } from "../lib/api";
import { clampSpot, FIELD_X, FIELD_Y } from "../lib/field";
import type { Pt, Scene } from "./scene";

/** The live model's answer as one path per player in scene coordinates, frames in order. */
export function whatIfPaths(scene: Scene, answer: Prediction): Map<number, Pt[]> {
  const paths = new Map<number, Pt[]>();
  for (const q of [...answer.predictions].sort((a, b) => a.frame_id - b.frame_id)) {
    const list = paths.get(q.nfl_id) ?? [];
    list.push(scene.toScene(q.x, q.y));
    paths.set(q.nfl_id, list);
  }
  return paths;
}

/** A landing spot kept within five yards of the field, like the phase 3 drag, rounded to a hundredth of a yard. */
export function clampLand(scene: Scene, p: Pt): Pt {
  const [x, y] = scene.toField(p);
  const r = (v: number) => Math.round(v * 100) / 100;
  return scene.toScene(r(clampSpot(x, FIELD_X)), r(clampSpot(y, FIELD_Y)));
}
