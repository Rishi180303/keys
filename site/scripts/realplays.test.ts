import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Game } from "../src/lib/types";
import { camera, CAMERAS, type Viewport } from "../src/replay/cameras";
import { along, buildScene } from "../src/replay/scene";
import { makeTimeline } from "../src/replay/timeline";

// Runs only on a machine with the site data: KEYS_GAMES_DIR=../data/site/games npx vitest run scripts/realplays
// The tracking data never goes in the repo, so CI skips this. It lives outside src so the site's type check, which
// has no node types, leaves it alone.
const dir = process.env.KEYS_GAMES_DIR;

describe.skipIf(!dir)("every real play", () => {
  it("stays in frame for every camera, wide and tall", () => {
    const vps: Viewport[] = [{ w: 1280, h: 720 }, { w: 390, h: 693 }];
    let checks = 0;
    const misses: string[] = [];
    for (const file of readdirSync(dir!).filter((f) => f.endsWith(".json"))) {
      const game = JSON.parse(readFileSync(join(dir!, file), "utf8")) as Game;
      for (const play of game.plays) {
        const s = buildScene(play);
        const tl = makeTimeline(s);
        const at = (a: typeof s.passer | null, f: number) => (a ? [along(a.path, f)] : []);
        for (const name of CAMERAS)
          for (const vp of vps)
            for (const f of [tl.start, tl.throwFrame, (tl.throwFrame + tl.arriveFrame) / 2, tl.arriveFrame]) {
              const thrown = f >= tl.throwFrame;
              const all = [...at(s.passer, f), ...at(s.target, f), ...s.defenders.flatMap((d) => at(d, f)), s.land];
              const ends = [...at(s.target, f), ...at(s.featured, f), s.land];
              const pts =
                name === "broadcast" ? all : name === "overhead" ? (thrown ? ends : all) : f === tl.throwFrame ? [...at(s.passer, f), ...at(s.target, f)] : f === tl.arriveFrame ? ends : [];
              const view = camera(name, s, f, vp);
              checks++;
              const bad = pts.filter(([l, u]) => {
                const p = view.project(l, u);
                return !p || p[0] < 0 || p[0] > vp.w || p[1] < 0 || p[1] > vp.h;
              });
              if (bad.length) misses.push(`${game.game}/${play.play} ${name} ${vp.w}x${vp.h} frame ${f}`);
            }
      }
    }
    console.log(`${checks} checks, ${misses.length} misses`, misses.slice(0, 10));
    expect(misses.length / checks).toBeLessThan(0.001);
  });
});
