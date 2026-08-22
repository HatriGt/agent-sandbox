import * as React from "react";

/**
 * Runs this browser started, in this session.
 *
 * The server keeps no run history: when a machine is destroyed its workspace, log and session are
 * gone. So a "recent runs" list can only honestly contain what this client itself started — which is
 * still useful (you started three machines ten minutes ago and want back into one) as long as the UI
 * never implies the server remembers. Kept in sessionStorage: it dies with the tab, like the data.
 */
export interface SessionRun {
  box: string;
  task: string;
  startedAt: number;
}

const KEY = "asb-session-runs";

function read(): SessionRun[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useSessionRuns() {
  const [runs, setRuns] = React.useState<SessionRun[]>(read);

  const remember = React.useCallback((box: string, task: string) => {
    setRuns((prev) => {
      if (prev.some((r) => r.box === box)) return prev;
      const next = [{ box, task, startedAt: Date.now() }, ...prev].slice(0, 20);
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode: the list still works for this render */
      }
      return next;
    });
  }, []);

  return { runs, remember };
}
