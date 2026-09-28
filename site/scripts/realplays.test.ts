import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Game } from "../src/lib/types";
import { camera, CAMERAS, type CameraName, type Viewport } from "../src/replay/cameras";
import { along, buildScene, type Pt, type Scene } from "../src/replay/scene";
import { makeTimeline } from "../src/replay/timeline";

// Runs only on a machine with the site data: KEYS_GAMES_DIR=../data/site/games npx vitest run scripts/realplays
// The tracking data never goes in the repo, so CI skips this. It lives outside src so the site's type check, which
// has no node types, leaves it alone.
const dir = process.env.KEYS_GAMES_DIR;

/** What each camera promises to keep in frame at a frame, the same promises as src/replay/cameras.test.ts. */
function promised(name: CameraName, s: Scene, frame: number, throwFrame: number, arriveFrame: number): Pt[] {
  const at = (a: Scene["passer"] | null) => (a ? [along(a.path, frame)] : []);
  const ends = [...at(s.target), ...at(s.featured), s.land];
  if (name === "broadcast") return [...at(s.passer), ...at(s.target), ...s.defenders.flatMap(at), s.land];
  if (name === "overhead") return frame >= throwFrame ? ends : [...at(s.passer), ...at(s.target), ...s.defenders.flatMap(at), s.land];
  if (frame === throwFrame) return [...at(s.passer), ...at(s.target)];
  if (frame === arriveFrame) return ends;
  return [];
}

describe.skipIf(!dir)("every real play", () => {
  it(
    "keeps what every camera promises in frame, wide and tall, featuring each rated defender in turn",
    () => {
      const vps: Viewport[] = [{ w: 1280, h: 720 }, { w: 390, h: 693 }];
      let checks = 0;
      const misses: string[] = [];
      for (const file of readdirSync(dir!).filter((f) => f.endsWith(".json"))) {
        const game = JSON.parse(readFileSync(join(dir!, file), "utf8")) as Game;
        for (const play of game.plays) {
          // the default featured defender for every camera, then every other rated defender for the cameras whose
          // promises name the featured defender (overhead after the throw, chase at arrival)
          const scenes = [{ s: buildScene(play), cams: CAMERAS }];
          for (const r of play.ratings) if (r.id !== scenes[0].s.featured?.id) scenes.push({ s: buildScene(play, r.id), cams: ["overhead", "chase"] });
          for (const { s, cams } of scenes) {
            const tl = makeTimeline(s);
            const frames = [tl.throwFrame, tl.arriveFrame];
            for (let f = tl.start; f < tl.arriveFrame; f += 2) frames.push(f);
            for (const name of cams)
              for (const vp of vps)
                for (const f of frames) {
                  const view = camera(name, s, f, vp);
                  checks++;
                  const bad = promised(name, s, f, tl.throwFrame, tl.arriveFrame).filter(([l, u]) => {
                    const p = view.project(l, u);
                    return !p || p[0] < 0.01 * vp.w || p[0] > 0.99 * vp.w || p[1] < 0.01 * vp.h || p[1] > 0.99 * vp.h;
                  });
                  if (bad.length) misses.push(`${game.game}/${play.play} featuring ${s.featured?.id} ${name} ${vp.w}x${vp.h} frame ${f}`);
                }
          }
        }
      }
      console.log(`${checks} checks, ${misses.length} misses`, misses.slice(0, 10));
      expect(misses).toEqual([]);
    },
    600_000,
  );
});
