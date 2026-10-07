import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { initMotionPref, useReducedMotion } from "./lib/motion-pref";
import { createBrowserRouter, RouterProvider } from "react-router";

// Type faces, self-hosted (variable where available) via fontsource.
import "@fontsource-variable/inter";
import "@fontsource/hedvig-letters-serif";
import "@fontsource-variable/geist-mono";

import "./index.css";
import App from "./App";
import { TokenGate } from "./components/TokenGate";
import { ErrorBoundary, RouteError } from "./components/ErrorBoundary";

// Resolve the motion setting onto <html data-motion> before first paint so CSS never flashes motion.
initMotionPref();

/** motion/react follows the in-app setting: transforms/layout collapse when reduced, full otherwise. */
function AppMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion={useReducedMotion() ? "always" : "never"}>{children}</MotionConfig>;
}

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
    <AppMotion>
      <Suspense fallback={<div className="bg-background h-full" aria-busy="true" />}>
        <RouterProvider router={router} />
      </Suspense>
    </AppMotion>
  </StrictMode>
);
