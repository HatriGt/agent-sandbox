import * as React from "react";
import { Check, Copy, RotateCw, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { useRouteError } from "react-router";
import { Button } from "@/components/ui/button";

/**
 * Last line of defence for the console: a render error shows a calm recovery screen with the
 * message, instead of React unmounting the whole tree to a blank page. "Try again" re-renders in
 * place (most render errors here come from a transient bad response); "Reload" is the hard reset.
 */
/** The same screen for errors React Router catches itself (loader/route-level). */
export function RouteError() {
  const err = useRouteError() as unknown;
  const message = err instanceof Error ? err.message : typeof err === "object" && err && "statusText" in err ? String((err as { statusText: string }).statusText) : String(err);
  return <Fallback message={message} retry={() => location.reload()} />;
}

function Fallback({ message, retry }: { message: string; retry: () => void }) {
  const still = useReducedMotion();
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${message}\n\n${location.href}\n${navigator.userAgent}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied: the text is selectable in the <pre> anyway */
    }
  };
  return (
    <div className="bg-background text-foreground flex min-h-full items-center justify-center px-6">
      <motion.div
        initial={still ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: still ? 0.12 : 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-md"
      >
        <span className="bg-destructive/10 text-destructive grid size-10 place-items-center rounded-md">
          <TriangleAlert className="size-5" aria-hidden />
        </span>
        <h1 className="mt-5 text-h2 font-semibold tracking-[-0.015em]">Something broke while rendering</h1>
        <p className="text-muted-foreground mt-2 text-body">
          Usually a response the console didn't expect — for example while the controller is redeploying. Nothing on the
          server is affected.
        </p>
        <div className="group relative mt-4">
          <pre className="bg-muted text-muted-foreground overflow-x-auto rounded-md px-3 py-2 pr-24 font-mono text-micro">{message}</pre>
          <Button size="xs" variant="outline" onClick={() => void copy()} className="absolute top-1.5 right-1.5" aria-live="polite">
            {copied ? <Check className="text-ok" /> : <Copy />}
            {copied ? "Copied" : "Copy details"}
          </Button>
        </div>
        <div className="mt-5 flex gap-2">
          <Button onClick={retry}>
            <RotateCw />
            Try again
          </Button>
          <Button variant="outline" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[console] render error", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <Fallback message={this.state.error.message} retry={() => this.setState({ error: null })} />;
  }
}
