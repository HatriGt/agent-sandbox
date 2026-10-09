import { api, type BoxView } from "@/lib/api";
import { isSleeping } from "@/lib/format";
import type { IconName } from "@/components/ui/Icon";

/** One machine control, shared by the ⋯ sheet rows and the fleet card's swipe actions. */
export type BoxAction = {
  label: string;
  icon: IconName;
  hint: string;
  /** Offered but not actionable right now (the sheet greys it out; the card doesn't show it). */
  disabled?: boolean;
  run: () => Promise<unknown>;
};

/** Keep (never reaped while asleep) ↔ Release. */
export function keepAction(box: BoxView): BoxAction {
  return {
    label: box.kept ? "Release" : "Keep",
    icon: "bookmark",
    hint: box.kept ? "kept — sleeps · auto-destroyed after release" : "never reaped while asleep",
    run: () => api.keep(box.name, !box.kept),
  };
}

/** Sleep ↔ Wake. A busy machine can't be put to sleep: the action is disabled, not hidden. */
export function sleepAction(box: BoxView): BoxAction {
  const sleeping = isSleeping(box.boxStatus);
  const running = box.runState === "running";
  return {
    label: sleeping ? "Wake" : "Sleep",
    icon: sleeping ? "sun" : "moon",
    hint: sleeping ? "restores the workspace and session" : running ? "busy — finish first" : "a reply wakes it",
    disabled: !sleeping && running,
    run: () => (sleeping ? api.wake(box.name) : api.sleep(box.name)),
  };
}
