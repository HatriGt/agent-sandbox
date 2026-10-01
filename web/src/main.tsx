import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
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
const SignInPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.SignInPage })));
const SignUpPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.SignUpPage })));

const router = createBrowserRouter([
  { path: "/", element: <Landing />, errorElement: <RouteError /> },
  { path: "/signin", element: <SignInPage />, errorElement: <RouteError /> },
  { path: "/signup", element: <SignUpPage />, errorElement: <RouteError /> },
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
    {/* Under prefers-reduced-motion every motion/react transform/layout animation collapses to an
        instant change (opacity fades are kept, short) — one switch instead of per-component checks. */}
    <MotionConfig reducedMotion="user">
      <Suspense fallback={<div className="bg-background h-full" aria-busy="true" />}>
        <RouterProvider router={router} />
      </Suspense>
    </MotionConfig>
  </StrictMode>
);
