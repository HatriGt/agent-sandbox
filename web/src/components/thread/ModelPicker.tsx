import * as React from "react";
import { api } from "@/lib/api";

/**
 * The model choice behind the composer's Settings panel (`RunSettings`). A pick sticks for the box
 * (the server holds it; localStorage repaints instantly). When the active model is not the
 * deployment default the composer shows it as a chip — a forgotten Haiku pick must be glanceable,
 * because it quietly degrades every following turn.
 */

export interface ModelChoice {
  id: string;
  label: string;
  tier: "opus" | "sonnet" | "haiku" | "other";
  /** Section header in the picker (provider label); absent → one flat list, as before. */
  group?: string;
  /** A saved model-provider id (Providers page) this model comes from. */
  provider?: string;
}

const LS_KEY = (box: string) => `asb-model-${box}`;

export function useModelChoice(box: string | null): {
  current: ModelChoice | null;
  models: ModelChoice[];
  defaultId: string;
  pick: (m: ModelChoice) => void;
  picked: string | null;
} {
  const [models, setModels] = React.useState<ModelChoice[]>([]);
  const [defaultId, setDefaultId] = React.useState("");
  const [serverCurrent, setServerCurrent] = React.useState<string | null>(null);
  // The pick the user made THIS session (sent with the next message); localStorage bridges reloads.
  const [picked, setPicked] = React.useState<string | null>(() => {
    try {
      return box ? localStorage.getItem(LS_KEY(box)) : null;
    } catch {
      return null;
    }
  });
  React.useEffect(() => {
    try {
      setPicked(box ? localStorage.getItem(LS_KEY(box)) : null);
    } catch {
      setPicked(null);
    }
  }, [box]);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .models(box ?? undefined, ctrl.signal)
      .then((r) => {
        setModels(r.models);
        setDefaultId(r.default);
        setServerCurrent(r.current);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [box]);
  const activeId = picked ?? serverCurrent ?? defaultId;
  const current = models.find((m) => m.id === activeId) ?? (activeId ? { id: activeId, label: activeId.replace(/^ak-claude-/, ""), tier: "other" as const } : null);
  const pick = React.useCallback(
    (m: ModelChoice) => {
      setPicked(m.id);
      try {
        if (box) localStorage.setItem(LS_KEY(box), m.id);
      } catch {
        /* storage blocked: session-only */
      }
    },
    [box]
  );
  return { current, models, defaultId, pick, picked };
}
