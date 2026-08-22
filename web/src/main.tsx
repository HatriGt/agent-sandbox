import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Self-hosted and bundled, not a Google Fonts <link>: no third-party request on every load, no
// FOUT waiting on fonts.googleapis.com, and the UI still renders correctly with no network beyond
// the container itself. The design system specifies Fira Sans for UI and Fira Code for identifiers,
// logs, and metrics — shipping the stack without the face would silently fall back to the platform
// sans, which is a different design.
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/600.css";
import "@fontsource-variable/fira-code";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
