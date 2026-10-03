import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api, type HarnessView } from "@/lib/api";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DRIVER_LABEL: Record<string, string> = { claude: "Claude Code", omp: "oh-my-pi", codex: "Codex CLI", opencode: "OpenCode" };

export function rulesLine(r: HarnessView["rules"]): string {
  const on = [r.askBeforeGuess && "ask before guessing", r.planFirst && "plan first", r.verifyOnDone && "verify on done"].filter(Boolean);
  return on.length ? on.join(", ") : "no rules";
}

/** Saved harnesses (driver · model · skills · rules · egress as one pick). Tap to edit. */
export default function Harnesses() {
  const router = useRouter();
  const [list, setList] = useState<HarnessView[] | null>(null);
  const [builtins, setBuiltins] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api
        .harnesses()
        .then((r) => {
          setList(r.harnesses);
          setBuiltins(r.builtins ?? 0);
        })
        .catch((e) => setError(msg(e)));
    }, []),
  );

  const mutate = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      setList((await api.harnessMutate(body)).harnesses);
    } catch (e) {
      setError(msg(e));
    }
  };

  const missingBuiltins = builtins > 0 && (list ?? []).filter((h) => h.builtin).length < builtins;

  return (
    <SettingsScreen title="Harnesses">
      <T variant="body" tone="muted">
        How your agents work: driver, model, skills, rules and egress, saved as one pick for the composer.
      </T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button small variant="secondary" title="+ New harness" onPress={() => router.push("/harness/new")} />
        {missingBuiltins ? <Button small variant="ghost" title="Restore built-ins" onPress={() => void mutate({ action: "restore-defaults" })} /> : null}
      </View>
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {list === null && !error ? <T tone="muted">Loading…</T> : null}
      {list?.length === 0 ? <T tone="muted">No harnesses yet.</T> : null}
      {list?.map((h) => (
        <Card key={h.id} onPress={() => router.push(`/harness/${encodeURIComponent(h.id)}`)}>
          <T variant="body" weight="semibold" numberOfLines={1}>
            {h.name}
            {h.builtin ? <T variant="micro" tone="faint">{"  built-in"}</T> : null}
          </T>
          {h.description ? (
            <T variant="meta" tone="muted" numberOfLines={2}>
              {h.description}
            </T>
          ) : null}
          <T variant="micro" tone="faint" numberOfLines={2} style={{ marginTop: 4 }}>
            {[h.driver ? DRIVER_LABEL[h.driver] ?? h.driver : "default driver", h.model, h.skills?.length ? `${h.skills.length} skills` : null, rulesLine(h.rules)].filter(Boolean).join(" · ")}
          </T>
          {h.providerMissing ? (
            <T variant="micro" tone="destructive">
              Its provider was removed — pick another.
            </T>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {h.needsReview ? <Button small title="Approve" onPress={() => void mutate({ action: "approve", id: h.id })} /> : null}
            <Button small variant="secondary" title="Duplicate" onPress={() => void mutate({ action: "duplicate", id: h.id })} />
            <ArmButton small variant="ghost" title="Delete" armedTitle="Tap to delete" onConfirm={() => mutate({ action: "delete", id: h.id })} />
          </View>
          {h.needsReview ? (
            <T variant="micro" tone="muted" style={{ marginTop: 4 }}>
              Imported — review it before it can run.
            </T>
          ) : null}
        </Card>
      ))}
    </SettingsScreen>
  );
}
