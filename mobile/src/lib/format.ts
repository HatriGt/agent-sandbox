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

export function fleetSentence(boxes: { runState: string; boxStatus: string }[]): string {
  const waiting = boxes.filter((b) => b.runState === "waiting").length;
  const running = boxes.filter((b) => b.runState === "running" && b.boxStatus === "Running").length;
  const sleeping = boxes.filter((b) => b.boxStatus === "Stopped").length;
  const parts: string[] = [];
  if (running) parts.push(`${plural(running, "machine")} working`);
  if (waiting) parts.push(`${waiting} waiting on you`);
  if (sleeping) parts.push(`${sleeping} sleeping`);
  if (!parts.length) return "The fleet is quiet.";
  return parts.join(", ") + ".";
}
