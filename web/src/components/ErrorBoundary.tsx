import * as React from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Last line of defence for the console: a render error shows a calm recovery screen with the
 * message, instead of React unmounting the whole tree to a blank page. "Try again" re-renders in
 * place (most render errors here come from a transient bad response); "Reload" is the hard reset.
 */
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
    return (
      <div className="bg-background text-foreground flex min-h-full items-center justify-center px-6">
        <div className="max-w-md">
          <span className="bg-destructive/10 text-destructive grid size-10 place-items-center rounded-lg">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <h1 className="mt-5 text-h2 font-semibold tracking-[-0.015em]">Something broke while rendering</h1>
          <p className="text-muted-foreground mt-2 text-body">
            Usually a response the console didn't expect — for example while the controller is redeploying. Nothing on
            the server is affected.
          </p>
          <pre className="bg-muted text-muted-foreground mt-4 overflow-x-auto rounded-lg px-3 py-2 font-mono text-micro">{this.state.error.message}</pre>
          <div className="mt-5 flex gap-2">
            <Button onClick={() => this.setState({ error: null })}>
              <RotateCw />
              Try again
            </Button>
            <Button variant="outline" onClick={() => location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
