/** The 32 teams by the codes in the data: the full name and the color for a player's badge. Where a team's main
 * color is close to black, the badge takes its brightest color instead, so it shows on the night background. */
export const TEAMS: Record<string, { name: string; color: string }> = {
  ARI: { name: "Arizona Cardinals", color: "#97233f" },
  ATL: { name: "Atlanta Falcons", color: "#a71930" },
  BAL: { name: "Baltimore Ravens", color: "#241773" },
  BUF: { name: "Buffalo Bills", color: "#00338d" },
  CAR: { name: "Carolina Panthers", color: "#0085ca" },
  CHI: { name: "Chicago Bears", color: "#c83803" },
  CIN: { name: "Cincinnati Bengals", color: "#fb4f14" },
  CLE: { name: "Cleveland Browns", color: "#ff3c00" },
  DAL: { name: "Dallas Cowboys", color: "#003594" },
  DEN: { name: "Denver Broncos", color: "#fb4f14" },
  DET: { name: "Detroit Lions", color: "#0076b6" },
  GB: { name: "Green Bay Packers", color: "#203731" },
  HOU: { name: "Houston Texans", color: "#a71930" },
  IND: { name: "Indianapolis Colts", color: "#002c5f" },
  JAX: { name: "Jacksonville Jaguars", color: "#006778" },
  KC: { name: "Kansas City Chiefs", color: "#e31837" },
  LA: { name: "Los Angeles Rams", color: "#003594" },
  LAC: { name: "Los Angeles Chargers", color: "#0080c6" },
  LV: { name: "Las Vegas Raiders", color: "#a5acaf" },
  MIA: { name: "Miami Dolphins", color: "#008e97" },
  MIN: { name: "Minnesota Vikings", color: "#4f2683" },
  NE: { name: "New England Patriots", color: "#c60c30" },
  NO: { name: "New Orleans Saints", color: "#d3bc8d" },
  NYG: { name: "New York Giants", color: "#0b2265" },
  NYJ: { name: "New York Jets", color: "#125740" },
  PHI: { name: "Philadelphia Eagles", color: "#004c54" },
  PIT: { name: "Pittsburgh Steelers", color: "#ffb612" },
  SEA: { name: "Seattle Seahawks", color: "#69be28" },
  SF: { name: "San Francisco 49ers", color: "#aa0000" },
  TB: { name: "Tampa Bay Buccaneers", color: "#d50a0a" },
  TEN: { name: "Tennessee Titans", color: "#4b92db" },
  WAS: { name: "Washington Commanders", color: "#5a1414" },
};

export const teamName = (code: string) => TEAMS[code]?.name ?? code;

/** Relative luminance of a #rrggbb color, as WCAG defines it. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The badge for a team: its color, with white or near black initials, whichever reads better. */
export function badge(code: string): { bg: string; fg: string } {
  const bg = TEAMS[code]?.color ?? "#334155";
  return { bg, fg: contrast(bg, "#ffffff") >= contrast(bg, "#05070a") ? "#ffffff" : "#05070a" };
}

/** Two initials for a badge: Pat Surtain II is PS, Kenneth Murray, Jr. is KM, Amon-Ra St. Brown is AB. */
export function initials(name: string): string {
  const words = name.replace(/,/g, " ").split(/\s+/).filter((w) => w && !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w));
  if (!words.length) return "?";
  const first = words[0][0];
  return (words.length > 1 ? first + words[words.length - 1][0] : first).toUpperCase();
}
