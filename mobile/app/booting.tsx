import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { takePendingDelegate } from "@/lib/pending-delegate";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { WorkingDot } from "@/components/ui/WorkingDot";

/** Shown the instant a task is submitted; replaces itself with the thread when the box exists. */
export default function Booting() {
  const router = useRouter();
  const { palette } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const task = useRef<string>("");

  useEffect(() => {
    const p = takePendingDelegate();
    if (!p) {
      router.replace("/(tabs)/home");
      return;
    }
    task.current = p.task;
    p.promise
      .then((r) => {
        if (r.ok) router.replace(`/box/${encodeURIComponent(r.box)}`);
        else setQuestion(r.question);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 14 }}>
        {error || question ? (
          <>
            <T serif variant="h2" style={{ textAlign: "center" }}>
              {question ? "The controller needs more detail" : "Could not start the task"}
            </T>
            <T variant="body" tone={question ? "muted" : "destructive"} style={{ textAlign: "center" }}>
              {question ?? error}
            </T>
            <Button title="Back to the task" onPress={() => router.replace({ pathname: "/new", params: { task: task.current } })} />
          </>
        ) : (
          <>
            <WorkingDot color={palette.live} size={14} />
            <T serif variant="h2">Starting a machine…</T>
            <T variant="body" tone="muted" numberOfLines={3} style={{ textAlign: "center" }}>
              {task.current}
            </T>
            <T variant="micro" tone="faint">
              A warm microVM is claimed in seconds; a cold boot takes a few more.
            </T>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
