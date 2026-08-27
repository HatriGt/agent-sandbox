import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

// Type faces, self-hosted (variable where available) via fontsource.
import "@fontsource-variable/inter";
import "@fontsource/hedvig-letters-serif";
import "@fontsource-variable/geist-mono";

import "./index.css";
import App from "./App";
import { TokenGate } from "./components/TokenGate";
import { ErrorBoundary, RouteError } from "./components/ErrorBoundary";

// The public landing page is code-split: the console never pays for it, and vice versa.
const Landing = lazy(() => import("./pages/Landing"));

const router = createBrowserRouter([
  { path: "/", element: <Landing />, errorElement: <RouteError /> },
  { path: "/dashboard/welcome", element: <Landing />, errorElement: <RouteError /> },
  {
    path: "/dashboard/*",
    errorElement: <RouteError />,
    element: (
      <ErrorBoundary>
        <TokenGate>
          <App />
        </TokenGate>
      </ErrorBoundary>
    ),
  },
  { path: "*", element: <Landing /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="bg-background h-full" aria-busy="true" />}>
      <RouterProvider router={router} />
    </Suspense>
  </StrictMode>
);
