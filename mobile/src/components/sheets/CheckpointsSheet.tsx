import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "@/lib/api";
import { T } from "../ui/AppText";
import { ArmButton } from "../ui/ArmButton";
import { Sheet } from "../ui/Sheet";

/**
 * Per-turn restore points (ring of 5). Revert restores workspace + agent
 * memory + visible thread as one unit; heavy dirs (node_modules & co) survive.
 */
export function CheckpointsSheet({
  session,
  visible,
  onClose,
  onReverted,
}: {
  session: string;
  visible: boolean;
  onClose: () => void;
  onReverted: () => void;
}) {
  const [points, setPoints] = useState<number[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setNote(null);
    api
      .revertPoints(session)
      .then((r) => setPoints(r.messages))
      .catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, [visible, session]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Checkpoints">
      <View style={{ gap: 10, paddingBottom: 12 }}>
        <T variant="meta" tone="muted">
          Revert restores the workspace, the agent's memory and the visible thread together, to the moment
          before that message was delivered. Installed dependencies are preserved.
        </T>
        {note ? <T variant="meta" tone="destructive">{note}</T> : null}
        {points === null ? (
          <T tone="muted">Loading…</T>
        ) : points.length === 0 ? (
          <T tone="muted">No restore points yet.</T>
        ) : (
          points
            .slice()
            .sort((a, b) => b - a)
            .map((turn) => (
              <View key={turn} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <T variant="body" weight="medium" style={{ flex: 1 }}>
                  {turn === 1 ? "Before the task (message 1)" : `Before message ${turn}`}
                </T>
                <ArmButton
                  title="Revert"
                  armedTitle="Tap again — discards later work"
                  small
                  onConfirm={async () => {
                    await api.revert(session, turn);
                    onReverted();
                    onClose();
                  }}
                />
              </View>
            ))
        )}
      </View>
    </Sheet>
  );
}
