/** One flagged defender play from plays.json. */
export type PlayRow = {
  game: number;
  play: number;
  week: number;
  id: number;
  name: string;
  pos: string;
  grp: string;
  team: string;
  cov: string;
  mz: string;
  route: string;
  result: string;
  epa: number | null;
  air: number;
  role: string;
  d0: number;
  dexp: number;
  dact: number;
  yards: number;
  z: number;
  zc: number;
  ex: string | null;
};

/** plays.json on disk: columnar, a third the size of objects. */
export type PlaysFile = { columns: string[]; rows: (string | number | null)[][] };

export type Shrink = Record<string, { within: number; between: number; k: number }>;

export type Cell = { dim: string; cell: string; n: number; mean: number; ok: boolean };

export type Gate = {
  passed: boolean;
  failed: string[];
  limit: number | null;
  player_sd: number | null;
  cells: Cell[];
  info: Record<string, Cell[]>;
  reliability: { r: number | null; players: number; ok: boolean };
  league_mean: { value: number | null; ok: boolean };
  excluded: { rows: number; share: number; by_reason: Record<string, number>; ok: boolean };
  rows: { flagged: number; rated: number; players_listed: number };
  rules: Record<string, number>;
};

export type Meta = {
  run: string;
  generated: string;
  api_url: string;
  summary: Record<string, { mean: number; min: number; max: number; folds: number }> | null;
  gate: Gate;
  shrink: Shrink;
  min_plays: number;
  counts: { plays: number; games: number };
};

/** A player in a game file: static fields, input frames as [x, y, s, a, dir, o], and for predicted players the
 * actual frames as [x, y] and the expected frames as [x, y, sd_x, sd_y]. */
export type GamePlayer = {
  id: number;
  name: string;
  pos: string;
  side: string;
  role: string;
  h: string;
  w: number;
  b: string;
  p: boolean;
  in: number[][];
  out?: number[][];
  pred?: number[][];
};

/** A flagged defender's rating row inside a game file. role here is primary or help. */
export type Rating = {
  id: number;
  role: string;
  d0: number;
  dexp: number;
  dact: number;
  yards: number;
  z: number;
  zc: number;
  ex: string | null;
};

export type Play = {
  play: number;
  desc: string;
  q: number;
  clock: string;
  down: number;
  dist: number;
  off: string;
  def: string;
  result: string;
  cov: string;
  mz: string;
  route: string;
  dir: string;
  yl: number;
  nfo: number;
  land: [number, number];
  players: GamePlayer[];
  ratings: Rating[];
};

export type Game = { game: number; week: number; home: string; away: string; plays: Play[] };
