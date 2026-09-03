// Hand-off between the New-task screen and the Booting screen: submit navigates
// instantly (like the web swapping to BootingThread) and the in-flight delegate
// promise rides along here instead of blocking the UI.
//
// `known` is the fleet as it looked at submit time (name -> role). The Booting
// screen polls the fleet and attaches to the box the moment it surfaces — a
// warm claim is an existing pool-free box whose role flips to pool-claimed —
// instead of waiting for the delegate call, which blocks server-side until the
// run reaches a boundary (could be a minute out).
import type { DelegateResult } from "./api";

export type PendingDelegate = {
  task: string;
  promise: Promise<DelegateResult>;
  known: Promise<Map<string, string>>;
};

let pending: PendingDelegate | null = null;

export function setPendingDelegate(task: string, promise: Promise<DelegateResult>, known: Promise<Map<string, string>>) {
  pending = { task, promise, known };
}

export function takePendingDelegate() {
  const p = pending;
  pending = null;
  return p;
}
