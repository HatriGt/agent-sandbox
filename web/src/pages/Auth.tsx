import { Navigate, useLocation, useNavigate } from "react-router";
import { useSession } from "@/lib/auth";
import { OperatorEntry, SignInCard, SignUpCard } from "@/components/auth/AuthForms";

/** /signin and /signup. Already signed in → straight to the console. */
function useReturnTo(): string {
  const { search } = useLocation();
  const to = new URLSearchParams(search).get("to");
  return to && /^\/dashboard(\/|$|\?)/.test(to) ? to : "/dashboard";
}

export function SignInPage() {
  const { ready, config, me, token } = useSession();
  const navigate = useNavigate();
  const to = useReturnTo();
  if (!ready || !config) return <div className="bg-background h-full" aria-busy="true" />;
  if (me || token) return <Navigate to={to} replace />;
  const done = () => navigate(to, { replace: true });
  if (config.mode !== "saas") return <OperatorEntry onDone={done} />;
  return <SignInCard config={config} to={to} onDone={done} />;
}

export function SignUpPage() {
  const { ready, config, me, token } = useSession();
  const navigate = useNavigate();
  const to = useReturnTo();
  if (!ready || !config) return <div className="bg-background h-full" aria-busy="true" />;
  if (me || token) return <Navigate to={to} replace />;
  if (config.mode !== "saas") return <Navigate to="/signin" replace />;
  return <SignUpCard config={config} to={to} onDone={() => navigate(to, { replace: true })} />;
}
