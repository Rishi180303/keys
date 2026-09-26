import type { Game, Meta, PlayRow, PlaysFile } from "./types";

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

function load<T>(path: string, convert: (raw: unknown) => T = (raw) => raw as T): Promise<T> {
  if (!cache.has(path)) {
    const pending = fetchJson<unknown>(path).then(convert);
    pending.catch(() => cache.delete(path));
    cache.set(path, pending);
  }
  return cache.get(path) as Promise<T>;
}

export const loadMeta = () => load<Meta>("/data/meta.json");
export const loadPlays = () => load<PlayRow[]>("/data/plays.json", (raw) => rowsFromColumns(raw as PlaysFile));
export const loadGame = (game: number) => load<Game>(`/data/games/${game}.json`);
