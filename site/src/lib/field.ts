export const FIELD_X = 120;
export const FIELD_Y = 53.3;

/** A landing spot coordinate, dragged or moved with the keys, kept within five yards of the field. */
export const clampSpot = (v: number, hi: number) => Math.min(Math.max(v, -5), hi + 5);
