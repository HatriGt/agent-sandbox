// Hand-off between the New-task screen and the Booting screen: submit navigates
// instantly (like the web swapping to BootingThread) and the in-flight delegate
// promise rides along here instead of blocking the UI.
import type { DelegateResult } from "./api";

let pending: { task: string; promise: Promise<DelegateResult> } | null = null;

export function setPendingDelegate(task: string, promise: Promise<DelegateResult>) {
  pending = { task, promise };
}

export function takePendingDelegate() {
  const p = pending;
  pending = null;
  return p;
}
