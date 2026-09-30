import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "./db.js";

/**
 * "How was this run started?" — the Trigger part of Run = Trigger × Harness × Box. Every delegation
 * lane sets it around its call (the composer: manual; a trigger: trigger; an MCP `after:` call:
 * after), and the controller's runDelegation wrapper records whatever is current against the new
 * box; a delegation with nothing set came in over MCP. Persisted per box so the receipt survives a
 * controller restart.
 */
export type StartedBy =
  | { kind: "manual" }
  | { kind: "mcp" }
  | { kind: "after"; parent: string }
  | { kind: "intake"; source: "email" | "slack"; from?: string }
  | { kind: "trigger"; triggerId: string; name: string; source: "schedule" | "webhook" | "github" | "chain"; event?: string; subject?: { kind: "issue" | "pr"; number: number; repo?: string }; /** chain: the box this run follows. */ parent?: string }
  /** A PR follow-up (src/pr-followups.ts): back on the PR's branch after CI failed or review feedback. */
  | { kind: "followup"; followup: "ci" | "review"; parent: string; pr: { repo: string; number: number }; attempt: number; subject: string; triggerId?: string };

const als = new AsyncLocalStorage<StartedBy>();
export const withStartedBy = <T>(s: StartedBy, fn: () => T): T => als.run(s, fn);
export const currentStartedBy = (): StartedBy | undefined => als.getStore();

export function recordStartedBy(db: Db, box: string, s: StartedBy, now = Date.now()): void {
  db.prepare(
    `INSERT INTO run_started_by (box, started_by_json, at) VALUES (?, ?, ?)
     ON CONFLICT(box) DO UPDATE SET started_by_json = excluded.started_by_json, at = excluded.at`
  ).run(box, JSON.stringify(s), now);
}

export function startedByOf(db: Db, box: string): StartedBy | undefined {
  const r = db.prepare(`SELECT started_by_json FROM run_started_by WHERE box = ?`).get(box) as { started_by_json: string } | undefined;
  if (!r) return undefined;
  try {
    return JSON.parse(r.started_by_json) as StartedBy;
  } catch {
    return undefined;
  }
}

export function forgetStartedBy(db: Db, box: string): void {
  db.prepare(`DELETE FROM run_started_by WHERE box = ?`).run(box);
}

/** "schedule ‹nightly›", "you, from the dashboard", "MCP", "after ‹box›". */
export function describeStartedBy(s: StartedBy | undefined): string | undefined {
  if (!s) return undefined;
  switch (s.kind) {
    case "manual":
      return "dashboard";
    case "mcp":
      return "MCP client";
    case "after":
      return `handoff after ${s.parent}`;
    case "trigger":
      return `${s.source} ${s.name}`;
    case "followup":
      return `${s.followup === "ci" ? "CI follow-up" : "review follow-up"} on ${s.pr.repo}#${s.pr.number}${s.attempt > 1 ? ` (attempt ${s.attempt})` : ""}`;
    case "intake":
      return s.source === "email" ? "email to your inbox address" : "Slack";
  }
}
