// Local activity feed: state edges observed while the app is open. The server
// deliberately stores no run history, so this is device-local and capped.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BoxView } from "./api";

export type ActivityEvent = {
  id: string;
  at: number;
  box: string;
  title?: string;
  kind: "waiting" | "done" | "failed";
  detail?: string;
};

const KEY = "asb-activity";
const CAP = 200;

let cache: ActivityEvent[] | null = null;
const listeners = new Set<() => void>();

export async function loadActivity(): Promise<ActivityEvent[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as ActivityEvent[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function subscribeActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function push(ev: ActivityEvent) {
  const list = await loadActivity();
  cache = [ev, ...list].slice(0, CAP);
  listeners.forEach((fn) => fn());
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
}

export async function clearActivity() {
  cache = [];
  listeners.forEach((fn) => fn());
  await AsyncStorage.removeItem(KEY);
}

type RunView = { runState: string; exitCode?: number; question?: string };
let prev = new Map<string, RunView>();
let hydrated = false;

/** Edge detection over fleet sweeps — first sighting is hydration, never an event. */
export function detectEdges(boxes: BoxView[]) {
  const next = new Map<string, RunView>();
  for (const b of boxes) {
    if (b.role === "pool-free") continue;
    next.set(b.name, { runState: b.runState, exitCode: b.exitCode, question: b.question });
  }
  if (hydrated) {
    for (const [name, cur] of next) {
      const was = prev.get(name);
      if (!was) continue;
      const box = boxes.find((b) => b.name === name)!;
      const title = box.title ?? box.task?.slice(0, 80);
      if (cur.runState === "waiting" && (was.runState !== "waiting" || (cur.question && cur.question !== was.question))) {
        void push({ id: `${name}-${Date.now()}`, at: Date.now(), box: name, title, kind: "waiting", detail: cur.question?.split("\n")[0] });
      } else if (cur.runState === "done" && was.runState !== "done") {
        void push({
          id: `${name}-${Date.now()}`,
          at: Date.now(),
          box: name,
          title,
          kind: cur.exitCode === 0 ? "done" : "failed",
          detail: cur.exitCode === 0 ? undefined : `exit ${cur.exitCode}`,
        });
      }
    }
  }
  prev = next;
  hydrated = true;
}
