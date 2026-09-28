import type { Scene } from "./scene";

export type Caption =
  | { kind: "rated"; who: string; yards: string; line: string }
  | { kind: "unrated"; who: string; line: string };

/** What the replay says at arrival about its featured defender, or null when it has no rating row for him. */
export function caption(scene: Scene): Caption | null {
  const f = scene.featured;
  const r = scene.rating;
  if (!f || !r) return null;
  const who = `${f.name} · ${f.pos} · ${scene.play.def}`;
  if (r.ex) return { kind: "unrated", who, line: `not rated: ${r.ex}` };
  const closer = r.yards >= 0;
  return {
    kind: "rated",
    who,
    yards: Math.abs(r.yards).toFixed(2),
    line: `${closer ? "closer to" : "farther from"} the catch point than the model expected`,
  };
}

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
const PARTICLE = /^(st\.?|van|vander|von|de|da|del|della|di|du|la|le)$/i;

/** The surname to label a player with: Pat Surtain II is SURTAIN, Kenneth Murray, Jr. is MURRAY, Amon-Ra St. Brown
 * is ST. BROWN, Leighton Vander Esch is VANDER ESCH. */
export function surname(name: string): string {
  const words = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && SUFFIX.test(words[words.length - 1])) words.pop();
  let i = words.length - 1;
  while (i > 1 && PARTICLE.test(words[i - 1])) i--;
  return words.slice(i).join(" ").toUpperCase();
}
