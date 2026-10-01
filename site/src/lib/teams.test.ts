import { describe, expect, it } from "vitest";
import { badge, contrast, initials, teamName, TEAMS } from "./teams";

describe("teams", () => {
  it("knows all 32 teams by the data's codes", () => {
    expect(Object.keys(TEAMS)).toHaveLength(32);
    expect([teamName("LA"), teamName("WAS"), teamName("JAX"), teamName("ZZZ")]).toEqual([
      "Los Angeles Rams", "Washington Commanders", "Jacksonville Jaguars", "ZZZ",
    ]);
  });
  it("gives every badge initials that read against its color", () => {
    for (const code of [...Object.keys(TEAMS), "ZZZ"]) {
      const { bg, fg } = badge(code);
      expect(contrast(bg, fg), code).toBeGreaterThanOrEqual(4.5);
    }
    expect(badge("PIT").fg).toBe("#05070a");
    expect(badge("BAL").fg).toBe("#ffffff");
  });
  it("takes initials from the first and last names, skipping suffixes", () => {
    expect(["Pat Surtain II", "Kenneth Murray, Jr.", "Amon-Ra St. Brown", "Jalen Ramsey", "Cher", ""].map(initials)).toEqual([
      "PS", "KM", "AB", "JR", "C", "?",
    ]);
  });
});
