// Incoming-link gate (expo-router): every asb:// or App Link URL passes through here before it is
// routed. Only the Thread and PR routes are reachable from outside the app; anything else lands on
// the index, which sends the user home or to sign-in. A link is untrusted input — it must not be able
// to open, say, a settings screen mid-action.
import { boxFromLink } from "@/lib/push";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const box = boxFromLink(path);
    if (box) return `/box/${encodeURIComponent(box)}`;
    // The PR route takes the repo as ONE encoded segment (owner%2Fname), as the dashboard emits it.
    const pr = String(path).match(/(?:^asb:\/\/|^\/?|\/)(?:dashboard\/)?pr\/([\w.%-]+)\/(\d+)\/?(?:[?#].*)?$/);
    if (pr) return `/pr/${pr[1]}/${pr[2]}`;
    return "/";
  } catch {
    return "/";
  }
}
