// Deterministic adjective-animal name, identical to the web's (lib/format.ts):
// the dashboard never shows raw box ids, so mobile must hash the same way.
const NAME_ADJECTIVES = [
  "amber", "brisk", "cobalt", "dusk", "ember", "fern", "glint", "hazel", "iris", "jade",
  "lunar", "mint", "nova", "onyx", "pine", "quartz", "rust", "sage", "teal", "vapor",
  "wren", "zephyr", "clay", "frost", "opal", "slate", "coral", "drift", "flint", "moss",
];
const NAME_NOUNS = [
  "otter", "falcon", "cedar", "harbor", "lark", "maple", "quokka", "raven", "sparrow", "tundra",
  "willow", "badger", "comet", "delta", "eagle", "finch", "grove", "heron", "ibis", "koi",
  "lynx", "marsh", "newt", "orbit", "puffin", "reef", "swift", "thorn", "vale", "yak",
];

function hashName(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function friendlyName(name: string): string {
  const h = hashName(name);
  return `${NAME_ADJECTIVES[h % NAME_ADJECTIVES.length]}-${NAME_NOUNS[(h >>> 8) % NAME_NOUNS.length]}`;
}

export function ago(ts?: number | null): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function durationWords(sec?: number | null): string {
  if (sec == null) return "";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function greeting(name?: string): string {
  const h = new Date().getHours();
  const part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name.split(" ")[0]}.` : `${part}.`;
}

// boxStatus casing varies by endpoint (fleet says "Stopped", watch says
// "stopped", live boxes are "running") — compare case-insensitively, like the web.
export function isUp(boxStatus?: string): boolean {
  return /^running$/i.test(boxStatus ?? "");
}

export function isSleeping(boxStatus?: string): boolean {
  return /^stopped$/i.test(boxStatus ?? "");
}

export function fleetSentence(boxes: { runState: string; boxStatus: string }[]): string {
  const waiting = boxes.filter((b) => b.runState === "waiting").length;
  const running = boxes.filter((b) => b.runState === "running" && isUp(b.boxStatus)).length;
  const sleeping = boxes.filter((b) => isSleeping(b.boxStatus)).length;
  const parts: string[] = [];
  if (running) parts.push(`${plural(running, "machine")} working`);
  if (waiting) parts.push(`${waiting} waiting on you`);
  if (sleeping) parts.push(`${sleeping} sleeping`);
  if (!parts.length) return "The fleet is quiet.";
  return parts.join(", ") + ".";
}
