import React, { useState } from "react";
import { View } from "react-native";
import { api, type BoxView } from "@/lib/api";
import { T } from "../ui/AppText";
import { ArmButton } from "../ui/ArmButton";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";

/** Machine controls: rename, pin, sleep/wake, and Destroy behind arm-to-confirm. */
export function BoxActionsSheet({
  box,
  visible,
  onClose,
  onChanged,
  onDestroyed,
}: {
  box: BoxView | null;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDestroyed?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);

  if (!box) return null;
  const sleeping = box.boxStatus === "Stopped";

  const act = async (fn: () => Promise<unknown>, done?: () => void) => {
    setNote(null);
    try {
      await fn();
      onChanged();
      done?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={box.title || box.name}>
      <View style={{ gap: 10, paddingBottom: 12 }}>
        {note ? <T variant="meta" tone="destructive">{note}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Field
            placeholder="Rename this run…"
            value={title}
            onChangeText={setTitle}
            style={{ flex: 1 }}
          />
          <Button
            title="Rename"
            small
            variant="secondary"
            onPress={() => title.trim() && act(() => api.rename(box.name, title.trim()), () => setTitle(""))}
          />
        </View>
        <Button
          title={box.kept ? "Unpin (allow reaping)" : "Pin — never reap while asleep"}
          variant="secondary"
          onPress={() => act(() => api.keep(box.name, !box.kept))}
        />
        <Button
          title={sleeping ? "Wake" : "Sleep — rootfs and session survive"}
          variant="secondary"
          onPress={() => act(() => (sleeping ? api.wake(box.name) : api.sleep(box.name)))}
        />
        <ArmButton
          title="Destroy machine"
          armedTitle="Tap again — destroys the VM and its transcript"
          onConfirm={() =>
            act(() => api.teardown(box.name), () => {
              onClose();
              onDestroyed?.();
            })
          }
        />
      </View>
    </Sheet>
  );
}
