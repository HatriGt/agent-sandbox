// "Focus the home composer" as a tiny module-level event: the tab bar's "+", the fleet's empty
// state, the Get-set-up checklist, "Run again" and a share intent all land the cursor in the same
// box instead of opening a second screen. A request made before Home has subscribed (cold start,
// lazy tab) is parked and delivered on subscribe, so the first tap never gets lost.
import { router } from "expo-router";

/** What the composer should hold when it takes focus; empty = just focus. */
export interface ComposeRequest {
  task?: string;
  /** A saved playbook to preselect (the Playbooks page's Run button). */
  workflow?: string;
}

type Listener = (req: ComposeRequest) => void;

const listeners = new Set<Listener>();
let pending: ComposeRequest | null = null;

export function focusComposer(req: ComposeRequest = {}): void {
  if (listeners.size === 0) {
    pending = req;
    return;
  }
  listeners.forEach((l) => l(req));
}

export function onFocusComposer(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    const p = pending;
    pending = null;
    listener(p);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Go to Home and put the cursor in the composer (optionally with a task / playbook prefilled). */
export function composeTask(req: ComposeRequest = {}): void {
  router.navigate("/(tabs)/home");
  focusComposer(req);
}
