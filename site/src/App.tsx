import { NavLink, Outlet } from "react-router";

export default function App() {
  return (
    <>
      <header className="top">
        <NavLink to="/" className="brand">
          keys
        </NavLink>
        <nav>
          <NavLink to="/" end>
            leaderboard
          </NavLink>
          <NavLink to="/about">about</NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
