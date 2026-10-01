/** Text helpers every page shares. */

/** A signed number with a real minus sign: +0.42, −1.30. */
export const signed = (v: number, d = 2) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(d);

export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A Kaggle code as words: COVER_3_ZONE is cover 3 zone. */
export const label = (s: string) => s.replace(/_/g, " ").toLowerCase();

const SUFFIX = ["th", "st", "nd", "rd"];
/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 112th. */
export const ordinal = (n: number) => n + (SUFFIX[((n % 100) - 20) % 10] ?? SUFFIX[n % 100] ?? SUFFIX[0]);

export const outcome = (r: string) => (r === "C" ? "complete" : r === "I" ? "incomplete" : "intercepted");

const GROUP_NAMES: Record<string, [string, string]> = {
  CB: ["corner", "corners"],
  S: ["safety", "safeties"],
  LB: ["linebacker", "linebackers"],
};

/** A position group in words, one or many: CB is corner or corners. */
export const groupName = (grp: string, many = true) => GROUP_NAMES[grp]?.[many ? 1 : 0] ?? grp;

/** Where a player stands in his group: 36th of 134 corners. */
export const rankText = (rank: number, total: number, grp: string) => `${ordinal(rank)} of ${total} ${groupName(grp)}`;
