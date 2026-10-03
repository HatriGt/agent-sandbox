import React, { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { api, type QueuedMessage } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { Sheet } from "./ui/Sheet";

/**
 * Follow-ups waiting for the running turn to end (web: TraceItems QueuedItem). The chip in the dock
 * opens a sheet listing them; each row can be delivered now (interrupts the turn — so it arms on the
 * first tap, like the web) or removed. The list refetches after every action and whenever the
 * watch snapshot's queue length changes.
 */

export function QueuedChip({ count, onPress }: { count: number; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: palette.lineStrong,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="inbox" size={13} color={palette.mutedForeground} />
      <T variant="meta" weight="medium" tone="muted">
        {count} queued
      </T>
    </Pressable>
  );
}

export function QueuedSheet({
  session,
  visible,
  onClose,
  queuedCount,
  onChanged,
}: {
  session: string;
  visible: boolean;
  onClose: () => void;
  /** Length of `box.queued` from the watch snapshot — a change refetches the list. */
  queuedCount: number;
  onChanged?: () => void;
}) {
  const { palette } = useTheme();
  const [items, setItems] = useState<QueuedMessage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.inbox(session);
      setItems(r.queued);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [session]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load, queuedCount]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const act = async (id: string, fn: () => Promise<{ queued: QueuedMessage[] }>) => {
    setBusy(id);
    setError(null);
    try {
      const r = await fn();
      setItems(r.queued);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setArmed(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Queued follow-ups">
      <View style={{ gap: 10, paddingBottom: 12 }}>
        <T variant="meta" tone="muted">
          Delivered when this turn ends — the agent reads them at its next step. "Send now" stops the current
          turn to deliver one immediately.
        </T>
        {error ? (
          <T variant="micro" tone="destructive">
            {error}
          </T>
        ) : null}
        {items === null ? (
          <T variant="meta" tone="faint">
            Loading…
          </T>
        ) : items.length === 0 ? (
          <T variant="meta" tone="faint">
            Nothing queued.
          </T>
        ) : (
          items.map((m) => {
            const inflight = busy === m.id;
            const isArmed = armed === m.id;
            return (
              <View
                key={m.id}
                style={{
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: palette.lineStrong,
                  borderRadius: radius.xl,
                  padding: 12,
                  gap: 8,
                  opacity: inflight ? 0.6 : 1,
                }}
              >
                <T variant="body" numberOfLines={2} selectable>
                  {m.text}
                </T>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <T variant="micro" tone="faint" style={{ flex: 1 }}>
                    {ago(m.at)}
                  </T>
                  <Pressable
                    disabled={inflight}
                    hitSlop={8}
                    onPress={() => (isArmed ? void act(m.id, () => api.sendNow(session, m.id)) : setArmed(m.id))}
                  >
                    <T variant="micro" weight="medium" tone={isArmed ? "destructive" : "default"}>
                      {inflight ? "Sending…" : isArmed ? "Stop the turn & send?" : "Send now"}
                    </T>
                  </Pressable>
                  <Pressable disabled={inflight} hitSlop={8} onPress={() => void act(m.id, () => api.dequeue(session, m.id))}>
                    <T variant="micro" weight="medium" tone="muted">
                      Remove
                    </T>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </View>
    </Sheet>
  );
}
