import React, { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { api, type PullInfo } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "../ui/AppText";
import { ArmButton } from "../ui/ArmButton";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

/** PR status + merge: method picker, auto-merge, and admin-override behind its own arm. */
export function PrSheet({
  session,
  repo,
  number,
  visible,
  onClose,
}: {
  session: string;
  repo: string;
  number: number;
  visible: boolean;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const [pr, setPr] = useState<PullInfo | null>(null);
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("squash");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .pull(repo, number)
      .then(setPr)
      .catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, [repo, number]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const merge = async (opts?: { auto?: boolean; admin?: boolean }) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.mergePull(session, repo, number, { method, ...opts });
      setNote(r.auto ? "Auto-merge armed — merges when checks pass." : "Merged.");
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const checks = pr?.checks;
  return (
    <Sheet visible={visible} onClose={onClose} title={`PR #${number}`}>
      <View style={{ gap: 12, paddingBottom: 12 }}>
        {note ? <T variant="meta" tone="muted">{note}</T> : null}
        {!pr ? (
          <T tone="muted">Loading…</T>
        ) : (
          <>
            <T variant="lead" weight="semibold" selectable>
              {pr.title}
            </T>
            <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
              <T variant="meta" tone={pr.state === "merged" ? "sleep" : pr.state === "open" ? "ok" : "muted"} weight="medium">
                {pr.state}
              </T>
              <T variant="meta" mono tone="ok">+{pr.additions}</T>
              <T variant="meta" mono tone="destructive">−{pr.deletions}</T>
              <T variant="meta" mono tone="muted" numberOfLines={1} style={{ maxWidth: "100%" }}>
                {pr.head} → {pr.base}
              </T>
            </View>
            {checks ? (
              <T variant="meta" tone={checks.failure ? "destructive" : checks.pending ? "muted" : "ok"}>
                {checks.failure
                  ? `✕ ${checks.failure} of ${checks.total} checks failing`
                  : checks.pending
                    ? `● ${checks.pending} of ${checks.total} checks pending`
                    : `✓ all ${checks.total} checks passing`}
              </T>
            ) : null}
            {pr.reviewDecision ? (
              <T variant="meta" tone={pr.reviewDecision === "approved" ? "ok" : "attention"}>
                {pr.reviewDecision === "approved" ? "✓ approved" : pr.reviewDecision.replace(/_/g, " ")}
              </T>
            ) : null}
            {pr.state === "open" && (
              <>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {(["merge", "squash", "rebase"] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setMethod(m)}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: radius.pill,
                        backgroundColor: method === m ? palette.accent : "transparent",
                        borderWidth: 1,
                        borderColor: method === m ? palette.lineStrong : palette.border,
                      }}
                    >
                      <T variant="meta" weight={method === m ? "semibold" : "regular"}>{m}</T>
                    </Pressable>
                  ))}
                </View>
                <Button title={`Merge (${method})`} onPress={() => merge()} loading={busy} />
                <Button title="Enable auto-merge" variant="secondary" onPress={() => merge({ auto: true })} disabled={busy} />
                <ArmButton
                  title="Admin override merge"
                  armedTitle="Tap again to bypass protections"
                  onConfirm={() => merge({ admin: true })}
                />
              </>
            )}
            <Button title="Open on GitHub" variant="outline" onPress={() => WebBrowser.openBrowserAsync(pr.url)} />
          </>
        )}
      </View>
    </Sheet>
  );
}
