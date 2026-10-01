import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { loadMeta, loadPhotos, loadPlays } from "./lib/data";
import { listed, mainTeam, search } from "./lib/people";
import type { PlayerRating } from "./lib/rating";
import type { Photos } from "./lib/types";
import { Avatar } from "./ui";

/** Search over the listed defenders by name. The season's plays load the first time the box is used. */
function Search({ onDone }: { onDone?: () => void }) {
  const [players, setPlayers] = useState<PlayerRating[] | null>(null);
  const [photos, setPhotos] = useState<Photos | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const list = useId();
  const started = useRef(false);

  const start = () => {
    if (started.current) return;
    started.current = true;
    Promise.all([loadPlays(), loadMeta()])
      .then(([rows, meta]) => setPlayers(listed(rows, meta)))
      .catch(() => {
        started.current = false;
        setFailed(true);
      });
    loadPhotos().then(setPhotos);
  };
  const hits = players ? search(players, q) : [];
  const shown = open && q.trim() !== "";
  const go = (p: PlayerRating) => {
    setQ("");
    setOpen(false);
    navigate(`/player/${p.id}`);
    onDone?.();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
      setOpen(true);
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="search">
      <input
        type="search"
        role="combobox"
        aria-label="Search defenders"
        aria-expanded={shown}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={shown && hits[active] ? `${list}-${hits[active].id}` : undefined}
        placeholder="Search defenders"
        value={q}
        onFocus={start}
        onChange={(e) => {
          start();
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {shown && (
        <ul id={list} role="listbox" className="hits">
          {failed && !players && <li className="none">The defenders did not load. Try again in a moment.</li>}
          {!failed && !players && <li className="none">Loading the defenders</li>}
          {players && !hits.length && <li className="none">No listed defender has that name</li>}
          {hits.map((p, i) => (
            <li
              key={p.id}
              id={`${list}-${p.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(p)}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar id={p.id} name={p.name} team={mainTeam(p)} photos={photos} size={28} />
              <span className="hit-name">{p.name}</span>
              <span className="hit-meta">
                {p.pos} {mainTeam(p)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  // a new page starts at its top with the menu closed
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <header className="nav">
        <div className="nav-in">
          <Link to="/" className="brand" aria-label="keys, home">
            KEYS
          </Link>
          <button type="button" className="menu-btn" aria-expanded={menu} aria-controls="nav-menu" onClick={() => setMenu(!menu)}>
            {menu ? "Close" : "Menu"}
          </button>
          <div id="nav-menu" className={`nav-menu${menu ? " open" : ""}`}>
            <nav aria-label="pages">
              <NavLink to="/" end>
                Home
              </NavLink>
              <NavLink to="/leaderboard">Leaderboard</NavLink>
              <NavLink to="/how">How it works</NavLink>
            </nav>
            <Search onDone={() => setMenu(false)} />
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="foot">
        <p>
          NFL Big Data Bowl 2026 tracking data, 2023 season. Player photos from Wikimedia Commons,{" "}
          <Link to="/how#photos">credited here</Link>. Code at{" "}
          <a href="https://github.com/Rishi180303/keys">github.com/Rishi180303/keys</a>.
        </p>
      </footer>
    </>
  );
}
