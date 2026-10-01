import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import App from "./App";
import About from "./pages/About";
import Leaderboard from "./pages/Leaderboard";
import Play from "./pages/Play";
import Player from "./pages/Player";
import "./styles.css";

// the replay lab exists only in development builds
const ReplayLab = import.meta.env.DEV ? lazy(() => import("./pages/ReplayLab")) : () => null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Leaderboard />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="player/:id" element={<Player />} />
          <Route path="play/:game/:play" element={<Play />} />
          <Route path="about" element={<About />} />
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
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
