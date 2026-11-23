import * as React from "react";

/**
 * Installable app plumbing. The manifest (`public/manifest.webmanifest`) and the service worker
 * (`sw/sw.js`, stamped into `dist/sw.js` by the build) make the console installable; this module
 * is the client side: register the worker in production, keep hold of the browser's deferred
 * install prompt so the Account page can offer "Install app", and say whether we are already
 * running as the installed app.
 *
 * `beforeinstallprompt` fires once, early, and only in Chromium browsers — so this module is
 * imported first in main.tsx and listens at load time; a component mounting later still sees it.
 * Safari and Firefox never fire it: there the page can only point at the browser's own menu.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface InstallState {
  /** The browser handed us a prompt we can open on a click. */
  canPrompt: boolean;
  /** Running inside the installed app (standalone window / home-screen launch). */
  standalone: boolean;
  /** Installed on this device during this page's life (the prompt was accepted). */
  installed: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
let state: InstallState = { canPrompt: false, standalone: isStandalone(), installed: false };
const listeners = new Set<() => void>();

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return !!window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

function emit(next: Partial<InstallState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep the prompt for our own button instead of the browser's mini-infobar.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit({ canPrompt: false, installed: true });
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", () => emit({ standalone: isStandalone() }));
}

/** Open the browser's install dialog. Resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const p = deferred;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  if (outcome === "accepted") {
    deferred = null;
    emit({ canPrompt: false, installed: true });
    return true;
  }
  return false;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const getState = () => state;
const SERVER: InstallState = { canPrompt: false, standalone: false, installed: false };

export function useInstall(): InstallState {
  return React.useSyncExternalStore(subscribe, getState, () => SERVER);
}

/**
 * Production only: the worker file exists in the built bundle alone, and a worker caching the dev
 * server's modules would only get in the way. Scope is the console path; the data routes at the
 * origin root are never within it.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/dashboard/sw.js", { scope: "/dashboard/" }).catch((e) => {
      console.warn("[pwa] service worker registration failed:", (e as Error).message);
    });
  });
}
