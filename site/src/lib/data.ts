import type { Game, Highlight, Meta, Photos, PlayRow, PlaysFile } from "./types";

/** Fetch one data file. A missing file arrives as the app's own index.html with status 200 because of the
 * client side routing rule, so the content type is the real check, and a bad body is an error, never a page. */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes("application/json")) throw new Error(`could not load ${url}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`could not read ${url}`);
  }
}

/** plays.json is columnar; the app works with one object per row. */
export function rowsFromColumns(file: PlaysFile): PlayRow[] {
  return file.rows.map((r) => Object.fromEntries(file.columns.map((c, i) => [c, r[i]])) as unknown as PlayRow);
}

const cache = new Map<string, Promise<unknown>>();
/** Game files are the big ones and a long visit can touch dozens, so only the latest few stay in memory. */
export const GAMES_KEPT = 6;
const isGame = (path: string) => path.startsWith("/data/games/");

function load<T>(path: string, convert: (raw: unknown) => T = (raw) => raw as T): Promise<T> {
  if (!cache.has(path)) {
    const pending = fetchJson<unknown>(path).then(convert);
    pending.catch(() => cache.delete(path));
    cache.set(path, pending);
    if (isGame(path)) {
      const games = [...cache.keys()].filter(isGame);
      for (const old of games.slice(0, Math.max(0, games.length - GAMES_KEPT))) cache.delete(old);
    }
  }
  return cache.get(path) as Promise<T>;
}

export const loadMeta = () => load<Meta>("/data/meta.json");
export const loadPlays = () => load<PlayRow[]>("/data/plays.json", (raw) => rowsFromColumns(raw as PlaysFile));
export const loadGame = (game: number) => load<Game>(`/data/games/${game}.json`);
export const loadHighlights = () => load<Highlight[]>("/data/highlights.json");
/** Photos are a nicety: without photos.json every player gets his team badge. */
export const loadPhotos = (): Promise<Photos> => load<Photos>("/data/photos.json").catch(() => ({}));
