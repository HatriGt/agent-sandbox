import * as React from "react";
import { Navigate, useLocation } from "react-router";
import { migrateTokenFromUrl, useSession } from "@/lib/auth";
import { OperatorEntry } from "@/components/auth/AuthForms";

/**
 * Guards the console. Multi-user mode: nobody signed in → the sign-in page (with a return path).
 * Token mode: the operator token entry, inline.
 */
export function TokenGate({ children }: { children: React.ReactNode }) {
  React.useEffect(() => migrateTokenFromUrl(), []);
  const { ready, config, me, token } = useSession();
  const { pathname, search } = useLocation();
  if (!ready || !config) return <div className="bg-background h-full" aria-busy="true" />;
  if (config.mode === "saas") {
    if (me || token) return <>{children}</>;
    return <Navigate to={`/signin?to=${encodeURIComponent(pathname + search)}`} replace />;
  }
  if (token) return <>{children}</>;
  return <OperatorEntry onDone={() => {}} />;
}
