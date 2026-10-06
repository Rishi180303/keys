import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, GAMES_KEPT, loadGame, loadMeta, rowsFromColumns } from "./data";

const respond = (body: string, type: string, status = 200) =>
  vi.fn(async () => new Response(body, { status, headers: { "content-type": type } }));

describe("fetchJson", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns parsed json", async () => {
    vi.stubGlobal("fetch", respond('{"run":"r1"}', "application/json"));
    expect(await fetchJson<{ run: string }>("/data/meta.json")).toEqual({ run: "r1" });
  });
  it("treats an html answer as a missing file, even with status 200", async () => {
    vi.stubGlobal("fetch", respond("<!doctype html><title>keys</title>", "text/html; charset=utf-8"));
    await expect(fetchJson("/data/games/1.json")).rejects.toThrow("could not load /data/games/1.json");
  });
  it("treats a bad status as a missing file", async () => {
    vi.stubGlobal("fetch", respond("{}", "application/json", 500));
    await expect(fetchJson("/data/plays.json")).rejects.toThrow("could not load");
  });
  it("treats a broken body as unreadable", async () => {
    vi.stubGlobal("fetch", respond("{not json", "application/json"));
    await expect(fetchJson("/data/plays.json")).rejects.toThrow("could not read");
  });
});

describe("rowsFromColumns", () => {
  it("zips columns and rows into objects", () => {
    const rows = rowsFromColumns({ columns: ["game", "play", "id", "ex"], rows: [[1, 2, 3, null], [1, 4, 5, "out of bounds"]] });
    expect(rows).toEqual([{ game: 1, play: 2, id: 3, ex: null }, { game: 1, play: 4, id: 5, ex: "out of bounds" }]);
  });
});

describe("load", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps only the latest game files and never drops the small files", async () => {
    const fetch = respond("{}", "application/json");
    vi.stubGlobal("fetch", fetch);
    await loadMeta();
    for (let g = 1; g <= GAMES_KEPT + 2; g++) await loadGame(g);
    const calls = fetch.mock.calls.length;
    await loadGame(GAMES_KEPT + 2);
    await loadMeta();
    expect(fetch.mock.calls.length).toBe(calls);
    await loadGame(1);
    expect(fetch.mock.calls.length).toBe(calls + 1);
  });
});
