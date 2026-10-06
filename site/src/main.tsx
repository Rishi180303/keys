import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import App from "./App";
import Home from "./pages/Home";
import How from "./pages/How";
import Leaderboard from "./pages/Leaderboard";
import Play from "./pages/Play";
import Player from "./pages/Player";
import { useTitle } from "./ui";
import "./styles.css";

function NotFound() {
  useTitle("No page here");
  return (
    <p className="page-msg">
      There is no page here. <Link to="/">Go to the highlights</Link>
    </p>
  );
}

// the replay lab exists only in development builds
const ReplayLab = import.meta.env.DEV ? lazy(() => import("./pages/ReplayLab")) : () => null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Home />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="player/:id" element={<Player />} />
          <Route path="play/:game/:play" element={<Play />} />
          <Route path="how" element={<How />} />
          {/* the phase 3 address of how it works */}
          <Route path="about" element={<Navigate to="/how" replace />} />
          {import.meta.env.DEV && (
            <Route
              path="lab/:game/:play"
              element={
                <Suspense>
                  <ReplayLab />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
