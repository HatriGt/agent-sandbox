import React from "react";
import { View } from "react-native";
import { api } from "@/lib/api";
import { fmtUsage, type Usage } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { Button } from "@/components/ui/Button";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";

/**
 * The memory rescue card — same contract as the web's MemoryBumpCard (web/src/components/thread/
 * MemoryCard.tsx): one tap raises the tier AND continues the task, so the user never has to know the
 * resize→resume sequence. Shown when the agent was OOM-killed (exit 137) or memory is critically
 * full mid-run; the /memory.json call returns once the box is back up, then a forced resume tells
 * the agent to pick up where it left off.
 */
export function MemoryBumpCard({
  session,
  kind,
  nextTier,
  memUsage,
  onDone,
  onError,
}: {
  session: string;
  kind: "oom" | "pressure";
  nextTier: string;
  memUsage?: Usage;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const { palette } = useTheme();
  const [phase, setPhase] = React.useState<"resizing" | "resuming" | null>(null);
  const oom = kind === "oom";
  const tone = oom ? palette.destructive : palette.attention;
  const usage = fmtUsage(memUsage);
  const bump = async () => {
    if (phase) return;
    setPhase("resizing");
    try {
      await api.setMemory(session, nextTier);
      setPhase("resuming");
      await api.resume(session, "The machine ran low on memory and was given more. Continue the task from where you left off.", { force: true });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase(null);
    }
  };
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: tone,
        backgroundColor: palette.card,
        borderRadius: radius.xl,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="cpu" size={15} color={tone} />
        <T variant="body" weight="semibold" style={{ flex: 1 }}>
          {oom ? "The machine ran out of memory" : `Memory is nearly full${usage ? ` — ${usage}` : ""}`}
        </T>
      </View>
      <T variant="meta" tone="muted">
        {oom
          ? `The kernel stopped the agent mid-task. Raise the memory to ${nextTier} and the agent continues from where it left off — the workspace and session are kept.`
          : `The agent may be stopped by the kernel any moment. Raising to ${nextTier} restarts the machine (workspace and session kept) and the agent continues automatically.`}
      </T>
      <Button
        title={phase === "resizing" ? "Adding memory…" : phase === "resuming" ? "Continuing the task…" : `Add memory (${nextTier}) & continue`}
        variant={oom ? "primary" : "attention"}
        loading={phase !== null}
        onPress={() => void bump()}
      />
    </View>
  );
}
