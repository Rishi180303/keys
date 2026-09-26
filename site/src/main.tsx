import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import App from "./App";
import Leaderboard from "./pages/Leaderboard";
import PlayViewer from "./pages/PlayViewer";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Leaderboard />} />
          <Route path="play/:game/:play" element={<PlayViewer />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
