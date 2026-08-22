import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Geist — Vercel's product/dev-UI face, self-hosted (variable) via fontsource: no Google Fonts
// request, no FOUT, correct offline rendering. Geist Sans for UI, Geist Mono for machine text (ids,
// vitals, tool calls, logs). Replaces the bespoke Archivo/Plex pairing.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
