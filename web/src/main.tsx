import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Self-hosted and bundled rather than a Google Fonts <link>: no third-party request per load, no
// FOUT waiting on fonts.googleapis.com, and correct rendering with no network beyond the container.
// Archivo is the single face (see DESIGN.md): a grotesk that holds tight tracking at display sizes
// the way the reference does, without being the Inter/Geist silhouette. IBM Plex Mono stays for
// genuine machine text — ids, vitals, tool calls, logs.
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
