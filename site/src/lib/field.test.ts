import { describe, expect, it } from "vitest";
import { clampSpot, FIELD_X, FIELD_Y } from "./field";

describe("clampSpot", () => {
  it("keeps a dragged or keyed landing spot within five yards of the field", () => {
    expect(clampSpot(-9, FIELD_X)).toBe(-5);
    expect(clampSpot(130, FIELD_X)).toBe(FIELD_X + 5);
    expect(clampSpot(20.5, FIELD_Y)).toBe(20.5);
    expect(clampSpot(60, FIELD_Y)).toBe(FIELD_Y + 5);
  });
});
