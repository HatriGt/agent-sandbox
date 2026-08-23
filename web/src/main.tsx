import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Type faces, self-hosted (variable where available) via fontsource: no Google Fonts request, no
// FOUT, correct offline rendering. Cloned from the CRM AI Agent reference:
//   Inter (UI/body) + Hedvig Letters Serif (the greeting/display serif) — the two faces the live
//   reference actually loads. Geist Mono is kept for machine text (ids, vitals, tool calls, logs),
//   which the reference has no distinct face for.
import "@fontsource-variable/inter";
import "@fontsource/hedvig-letters-serif";
import "@fontsource-variable/geist-mono";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
