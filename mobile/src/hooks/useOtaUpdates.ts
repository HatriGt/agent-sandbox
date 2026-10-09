import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

/**
 * Apply OTA updates without waiting for a cold start. expo-updates' ON_LOAD only *downloads* on
 * launch and applies on the next process start, which on Android can be days away (recents keeps
 * the process alive). So: on every foreground, check; if an update is available, fetch it and
 * reload right away. Mount once at the root; the cost is a one-time reload shortly after
 * foregrounding when a new build is live.
 * No-op in dev (Updates.isEnabled is false under the dev client).
 */
export function useOtaUpdates(): void {
  const busy = useRef(false);
  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const check = await Updates.checkForUpdateAsync();
        if (check.isAvailable) {
          const fetched = await Updates.fetchUpdateAsync();
          if (fetched.isNew) await Updates.reloadAsync();
        }
      } catch {
        // Offline or the update server is unreachable: the embedded/cached bundle keeps running.
      } finally {
        busy.current = false;
      }
    };
    void run();
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") void run();
    });
    return () => sub.remove();
  }, []);
}
