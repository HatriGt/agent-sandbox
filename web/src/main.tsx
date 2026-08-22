import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Self-hosted and bundled rather than a Google Fonts <link>: no third-party request per load, no
// FOUT waiting on fonts.googleapis.com, and correct rendering with no network beyond the container.
// IBM Plex is the point of view — engineered, technical heritage, and specifically not the
// Inter/Geist silhouette every generated dashboard ships with.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
