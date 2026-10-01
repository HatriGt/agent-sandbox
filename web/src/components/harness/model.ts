import type { AgentId, HarnessRules, HarnessView } from "@/lib/api";

/** The editor's working copy of a harness: strings for the free-text fields, parsed on save. */
export interface HarnessDraft {
  id?: string;
  name: string;
  description: string;
  driver: AgentId | "";
  providerId: string;
  model: string;
  skills: string[];
  rules: HarnessRules;
  rulesMd: string;
  verifyCommand: string;
  egress: string;
}

/** The on/off rules; autoRetry (a count) has its own field next to the verify command. */
export const RULE_LABELS: Array<{ key: "askBeforeGuess" | "planFirst" | "verifyOnDone"; label: string; line: string }> = [
  { key: "askBeforeGuess", label: "Ask before guessing", line: "Ask and wait when a requirement is ambiguous." },
  { key: "planFirst", label: "Plan first", line: "Write a short numbered plan before changing anything." },
  { key: "verifyOnDone", label: "Verify on done", line: "Run the verify command (or a checker) when the run finishes." },
];

export function emptyDraft(): HarnessDraft {
  return {
    name: "",
    description: "",
    driver: "",
    providerId: "",
    model: "",
    skills: [],
    rules: { askBeforeGuess: true, planFirst: false, verifyOnDone: false },
    rulesMd: "",
    verifyCommand: "",
    egress: "",
  };
}

export function draftOf(h: HarnessView): HarnessDraft {
  return {
    id: h.id,
    name: h.name,
    description: h.description ?? "",
    driver: h.driver ?? "",
    providerId: h.providerId ?? "",
    model: h.model ?? "",
    skills: h.skills ?? [],
    rules: { ...h.rules },
    rulesMd: h.rulesMd ?? "",
    verifyCommand: h.verifyCommand ?? "",
    egress: (h.egress ?? []).join("\n"),
  };
}

/** Draft → the body POST /harnesses.json validates. Blank means "leave to the run / defaults". */
export function bodyOf(d: HarnessDraft): Record<string, unknown> {
  const egress = d.egress
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name: d.name.trim(),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    ...(d.driver ? { driver: d.driver } : {}),
    ...(d.providerId ? { providerId: d.providerId } : {}),
    ...(d.model.trim() ? { model: d.model.trim() } : {}),
    ...(d.skills.length ? { skills: d.skills } : {}),
    rules: d.rules,
    ...(d.rulesMd.trim() ? { rulesMd: d.rulesMd } : {}),
    ...(d.verifyCommand.trim() ? { verifyCommand: d.verifyCommand.trim() } : {}),
    ...(egress.length ? { egress } : {}),
  };
}

export function rulesLine(r: HarnessRules): string {
  const on = RULE_LABELS.filter((x) => r[x.key]).map((x) => x.label.toLowerCase());
  return on.length ? on.join(", ") : "no rules";
}

/** Save a JSON document as a download (Blob, no network). */
export function downloadJson(filename: string, doc: unknown) {
  const blob = new Blob([JSON.stringify(doc, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
