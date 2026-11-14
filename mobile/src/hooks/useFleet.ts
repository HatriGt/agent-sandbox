import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, type FleetSnapshot } from "@/lib/api";
import { detectEdges } from "@/lib/activity";

const TICK_MS = 4000;

/** Poll /fleet.json while the app is foregrounded; feeds the local activity edge-detector. */
export function useFleet(active = true) {
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useCallback(async () => {
    try {
      const s = await api.fleet();
      setSnap(s);
      setError(null);
      detectEdges(s.boxes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    // A foreground restart while a tick is still in flight must not leave that tick's loop running
    // too — each restart bumps the generation and only the newest loop reschedules (otherwise
    // every resume could add another parallel poller).
    let gen = 0;
    const loop = async (mine: number) => {
      await tick();
      if (!stopped && mine === gen) timer.current = setTimeout(() => void loop(mine), TICK_MS);
    };
    void loop(gen);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active" && !stopped) {
        if (timer.current) clearTimeout(timer.current);
        void loop(++gen);
      }
    });
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      sub.remove();
    };
  }, [active, tick]);

  return { snap, error, refresh: tick };
}
