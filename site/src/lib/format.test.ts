import { describe, expect, it } from "vitest";
import { groupName, label, ordinal, outcome, pct, rankText, signed } from "./format";

describe("format", () => {
  it("signs numbers with a real minus", () => {
    expect([signed(0.4249), signed(-1.3), signed(0), signed(-0.004)]).toEqual(["+0.42", "−1.30", "+0.00", "−0.00"]);
    expect(signed(2.5, 1)).toBe("+2.5");
  });
  it("writes ordinals the English way", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 112, 134].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th", "112th", "134th",
    ]);
  });
  it("names groups and ranks within them", () => {
    expect(rankText(36, 134, "CB")).toBe("36th of 134 corners");
    expect(rankText(1, 101, "S")).toBe("1st of 101 safeties");
    expect([groupName("LB", false), groupName("XX")]).toEqual(["linebacker", "XX"]);
  });
  it("turns codes and results into words", () => {
    expect(label("COVER_3_ZONE")).toBe("cover 3 zone");
    expect([outcome("C"), outcome("I"), outcome("IN")]).toEqual(["complete", "incomplete", "intercepted"]);
    expect(pct(0.645)).toBe("65%");
  });
});
