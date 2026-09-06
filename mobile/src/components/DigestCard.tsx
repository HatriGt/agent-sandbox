import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { api, type RunDigest } from "@/lib/api";
import { shortDuration, shortPath } from "@/lib/planTasks";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { FadeInUp } from "./ui/Motion";

const FILE_CAP = 6;

/**
 * The run receipt's expandable detail — the server-derived digest (src/digest.ts)
 * under the RunSummary pill. Collapsed it is one line: state mark, headline,
 * duration, chevron. Open it shows the plan checklist, changed files with ±
 * counts, failed commands, and how many questions were asked. Fetched once per
 * finished run (the parent keys us by exit/turn); a failed fetch renders nothing.
 */
export function DigestCard({ session, fetchKey }: { session: string; fetchKey: string }) {
  const { palette } = useTheme();
  const [digest, setDigest] = useState<RunDigest | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDigest(null);
    api
      .digest(session)
      .then((d) => {
        if (!cancelled && (d.state === "done" || d.state === "failed")) setDigest(d);
      })
      .catch(() => {}); // no digest, no card — the RunSummary pill still carries the outcome
    return () => {
      cancelled = true;
    };
  }, [session, fetchKey]);

  if (!digest) return null;

  const failed = digest.state === "failed";
  const stateColor = failed ? palette.destructive : palette.ok;
  const durationMs =
    digest.startedAt !== undefined && digest.endedAt !== undefined && digest.endedAt > digest.startedAt
      ? digest.endedAt - digest.startedAt
      : undefined;
  const files = digest.files.slice(0, FILE_CAP);
  const moreFiles = digest.files.length - files.length;
  const hasDetail =
    digest.plan.length > 0 || digest.files.length > 0 || digest.failedCommands.length > 0 || digest.questions.length > 0;

  return (
    <FadeInUp>
      <View
        style={{
          backgroundColor: palette.card,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: radius.xl,
          marginBottom: 10,
          overflow: "hidden",
        }}
      >
        <Pressable
          disabled={!hasDetail}
          onPress={() => setOpen((o) => !o)}
          accessibilityLabel={open ? "Collapse run receipt" : "Expand run receipt"}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon name="clipboard" size={14} color={stateColor} />
          <T variant="meta" weight="medium" numberOfLines={open ? undefined : 1} style={{ flex: 1, minWidth: 0 }}>
            {digest.headline}
          </T>
          {durationMs !== undefined ? (
            <T variant="micro" mono tone="faint" style={{ flexShrink: 0 }}>
              {shortDuration(durationMs)}
            </T>
          ) : null}
          {hasDetail ? <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={palette.faint} /> : null}
        </Pressable>

        {digest.verified ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 8,
              paddingHorizontal: 12,
              paddingBottom: open && hasDetail ? 0 : 10,
              marginTop: -2,
              marginBottom: open && hasDetail ? 8 : 0,
            }}
          >
            <Icon
              name={digest.verified.pass ? "check" : "alert-triangle"}
              size={12}
              color={digest.verified.pass ? palette.ok : palette.destructive}
              style={{ marginTop: 3 }}
            />
            <T
              variant="micro"
              numberOfLines={3}
              style={{ flex: 1, minWidth: 0, color: digest.verified.pass ? palette.ok : palette.destructive }}
            >
              {digest.verified.pass
                ? `verified · ${digest.verified.detail}`
                : `UNVERIFIED — ${digest.verified.detail}`}
            </T>
          </View>
        ) : null}

        {open && hasDetail ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
            {digest.plan.length > 0 && (
              <View style={{ gap: 5 }}>
                <T variant="micro" tone="faint" weight="semibold">
                  Plan
                </T>
                {digest.plan.map((step, i) => {
                  const c = step.failed ? palette.destructive : step.state === "done" ? palette.ok : palette.faint;
                  return (
                    <View key={`${i}-${step.text}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                      <Icon
                        name={step.failed ? "alert-triangle" : step.state === "done" ? "check" : "circle"}
                        size={step.state === "done" || step.failed ? 12 : 8}
                        color={c}
                        style={{ marginTop: 4, width: 12 }}
                      />
                      <T
                        variant="meta"
                        tone={step.failed ? "destructive" : step.state === "done" ? "muted" : "faint"}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        {step.text}
                      </T>
                    </View>
                  );
                })}
              </View>
            )}

            {digest.files.length > 0 && (
              <View style={{ gap: 4 }}>
                <T variant="micro" tone="faint" weight="semibold">
                  Files
                </T>
                {files.map((f) => (
                  <View key={f.path} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <T variant="micro" mono tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                      {shortPath(f.path)}
                    </T>
                    <T variant="micro" mono style={{ color: palette.ok, flexShrink: 0 }}>
                      +{f.additions}
                    </T>
                    <T variant="micro" mono style={{ color: palette.destructive, flexShrink: 0 }}>
                      −{f.deletions}
                    </T>
                  </View>
                ))}
                {moreFiles > 0 ? (
                  <T variant="micro" mono tone="faint">
                    +{moreFiles} more
                  </T>
                ) : null}
              </View>
            )}

            {digest.failedCommands.length > 0 && (
              <View style={{ gap: 4 }}>
                <T variant="micro" tone="destructive" weight="semibold">
                  Failed commands
                </T>
                {digest.failedCommands.map((c, i) => (
                  <T key={`${i}-${c.name}`} variant="micro" mono tone="muted" numberOfLines={1}>
                    {c.name}
                    {c.arg ? `  ${shortPath(c.arg.split("\n")[0])}` : ""}
                  </T>
                ))}
              </View>
            )}

            {digest.questions.length > 0 && (
              <T variant="micro" tone="faint">
                {digest.questions.length} question{digest.questions.length === 1 ? "" : "s"} asked
              </T>
            )}
          </View>
        ) : null}
      </View>
    </FadeInUp>
  );
}
