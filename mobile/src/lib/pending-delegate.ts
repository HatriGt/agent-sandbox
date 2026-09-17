// Hand-off between the New-task screen and the Booting screen: submit navigates
// instantly (like the web swapping to BootingThread) and the in-flight delegate
// promise rides along here instead of blocking the UI.
//
// `known` is the fleet as it looked at submit time (name -> role). The Booting
// screen polls the fleet and attaches to the box the moment it surfaces — a
// warm claim is an existing pool-free box whose role flips to pool-claimed —
// instead of waiting for the delegate call, which blocks server-side until the
// run reaches a boundary (could be a minute out).
//
// `draft` is everything the composer held at submit time. On a failed delegate
// the Booting screen stashes it back (with the error) so "Back to the task"
// restores the WHOLE submission — repos, photos, model, verify — not just the
// text. Without this, a refusal cost the user every photo they had attached.
import type { DelegateResult } from "./api";

export type SubmitDraft = {
  task: string;
  picked: { repo: string; ref?: string }[];
  attachments: { name: string; dataUrl: string }[];
  model: string | null;
  verify?: { mode: "command" | "criterion"; text: string };
};

export type PendingDelegate = {
  task: string;
  promise: Promise<DelegateResult>;
  /** null when the submit-time fleet read failed — the Booting screen must re-baseline before attaching. */
  known: Promise<Map<string, string> | null>;
  draft: SubmitDraft;
};

let pending: PendingDelegate | null = null;

export function setPendingDelegate(p: PendingDelegate) {
  pending = p;
}

export function takePendingDelegate() {
  const p = pending;
  pending = null;
  return p;
}

export type FailedSubmit = SubmitDraft & { error?: string; clarify?: string };

let failed: FailedSubmit | null = null;

export function setFailedSubmit(f: FailedSubmit) {
  failed = f;
}

/** One-shot: the New-task screen consumes this on mount to restore a failed submission. */
export function takeFailedSubmit() {
  const f = failed;
  failed = null;
  return f;
}
