// "Share to Agent Sandbox": text or a link shared from another app (Android text/plain intent, the
// iOS share extension) opens the new-task composer prefilled. Nothing starts without the person
// pressing send. A share that arrives signed out waits until sign-in. Renders nothing.
import { useEffect } from "react";
import { useShareIntentContext, type ShareIntent } from "expo-share-intent";
import { useAuth } from "@/state/auth";
import { composeTask } from "@/state/composerFocus";

const MAX = 20_000;

/** Title + text + link, deduplicated (Android often puts the URL inside the text as well). */
export function shareToTask(s: Pick<ShareIntent, "text" | "webUrl" | "meta">): string {
  const parts: string[] = [];
  const title = s.meta?.title?.trim();
  const text = s.text?.trim();
  const url = s.webUrl?.trim();
  if (title && !text?.includes(title)) parts.push(title);
  if (text) parts.push(text);
  if (url && !text?.includes(url)) parts.push(url);
  return parts.join("\n\n").slice(0, MAX);
}

export function ShareBridge() {
  const { ready, signedIn } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    if (!ready || !signedIn || !hasShareIntent) return;
    const task = shareToTask(shareIntent);
    resetShareIntent();
    if (task) composeTask({ task });
  }, [ready, signedIn, hasShareIntent, shareIntent, resetShareIntent]);

  return null;
}
