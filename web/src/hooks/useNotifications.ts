import * as React from "react";
import type { BoxView } from "@/lib/api";
import { friendlyName, threadTitle } from "@/lib/format";
import { questionHeadline } from "@/lib/question";

/**
 * Desktop notifications for the two transitions that need a human: a machine pausing on a question,
 * and a run finishing. Opt-in (the browser asks once), persisted, and only fired for transitions
 * this tab has actually observed — never on first load, so opening the dashboard to three waiting
 * machines does not fire three alerts.
 *
 * Also keeps the document title honest: "(2) Agent Sandbox" while anything needs you.
 */
const KEY = "asb-notify";

export function useNotifications(boxes: BoxView[], onOpen: (name: string) => void) {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [enabled, setEnabled] = React.useState<boolean>(() => {
    try {
      return supported && localStorage.getItem(KEY) === "1" && Notification.permission === "granted";
    } catch {
      return false;
    }
  });
  const prev = React.useRef<Map<string, string> | null>(null);

  const toggle = React.useCallback(async () => {
    if (!supported) return;
    const remember = (v: string) => {
      try {
        localStorage.setItem(KEY, v);
      } catch {
        /* storage blocked: the setting lives for this tab only */
      }
    };
    if (enabled) {
      setEnabled(false);
      remember("0");
      return;
    }
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    const on = perm === "granted";
    setEnabled(on);
    remember(on ? "1" : "0");
  }, [enabled, supported]);

  React.useEffect(() => {
    const now = new Map(boxes.map((b) => [b.name, b.runState]));
    if (prev.current && enabled && document.hidden) {
      for (const b of boxes) {
        const before = prev.current.get(b.name);
        if (!before || before === b.runState) continue;
        if (b.runState === "waiting") {
          fire(`${friendlyName(b.name)} needs your answer`, b.question ? questionHeadline(b.question) : threadTitle(b), b.name, onOpen);
        } else if (b.runState === "done") {
          fire(
            `${friendlyName(b.name)} ${b.exitCode ? `exited with code ${b.exitCode}` : "finished"}`,
            threadTitle(b),
            b.name,
            onOpen
          );
        }
      }
    }
    prev.current = now;
  }, [boxes, enabled, onOpen]);

  const waiting = boxes.filter((b) => b.runState === "waiting").length;
  React.useEffect(() => {
    document.title = waiting ? `(${waiting}) Agent Sandbox` : "Agent Sandbox";
  }, [waiting]);

  return { supported, enabled, toggle };
}

function fire(title: string, body: string, name: string, onOpen: (name: string) => void) {
  try {
    const n = new Notification(title, { body, tag: name });
    n.onclick = () => {
      window.focus();
      onOpen(name);
      n.close();
    };
  } catch {
    /* notification blocked at OS level */
  }
}
