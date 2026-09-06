import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { api, type HistoryRun, type RunDigest } from "@/lib/api";
import { ago, durationWords, friendlyName } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "./ui/AppText";
import { ArmButton } from "./ui/ArmButton";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { FadeInUp } from "./ui/Motion";
import { CardSkeleton } from "./ui/Skeleton";
import { DigestView } from "./DigestCard";

const PAGE = 25;

/**
 * History: finished runs kept by the server after their machines are gone (src/run-archive.ts).
 * Deliberately still — fetched once, no polling; the live picture lives on Fleet and the Activity
 * tab. A row expands into the archived receipt, and offers exactly two actions: run the same brief
 * again on a new machine, or forget the record.
 */
export function HistoryList() {
  const router = useRouter();
  const { palette } = useTheme();
  const [rows, setRows] = useState<HistoryRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .history({ limit: PAGE })
      .then((r) => {
        if (cancelled) return;
        setRows(r.runs);
        setMore(r.runs.length === PAGE);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showMore = useCallback(async () => {
    if (!rows?.length) return;
    setLoadingMore(true);
    try {
      const r = await api.history({ limit: PAGE, before: rows[rows.length - 1].id });
      setRows((prev) => [...(prev ?? []), ...r.runs]);
      setMore(r.runs.length === PAGE);
    } catch {
      // A failed page leaves the loaded ones alone; the button stays for another try.
    } finally {
      setLoadingMore(false);
    }
  }, [rows]);

  const forget = async (id: number) => {
    try {
      await api.historyDelete(id);
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    } catch {
      // Nothing removed — the row stays, which is the honest picture.
    }
  };

  if (error) {
    return (
      <T variant="body" tone="destructive">
        Could not load history: {error}
      </T>
    );
  }
  if (rows === null) {
    return (
      <View style={{ gap: 10 }}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </View>
    );
  }
  if (!rows.length) {
    return (
      <T variant="body" tone="muted">
        When a run finishes, its receipt is kept here — even after the machine is reaped. Nothing yet.
      </T>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {rows.map((r, i) => {
        const at = r.archivedAt || r.endedAt || 0;
        const prev = i > 0 ? rows[i - 1].archivedAt || rows[i - 1].endedAt || 0 : null;
        const head = at && (prev === null || dayLabel(prev) !== dayLabel(at)) ? dayLabel(at) : null;
        const failed = r.state === "failed";
        // Archive stamps are epoch ms; durationWords speaks seconds, ago speaks ms.
        const secs = r.startedAt && r.endedAt && r.endedAt > r.startedAt ? Math.round((r.endedAt - r.startedAt) / 1000) : null;
        return (
          <React.Fragment key={r.id}>
            {head ? (
              <T variant="micro" tone="faint" weight="semibold" style={{ marginTop: i === 0 ? 0 : 6 }}>
                {head.toUpperCase()}
              </T>
            ) : null}
            <FadeInUp delay={Math.min(i, 8) * 40}>
              <Card onPress={() => setOpenId((cur) => (cur === r.id ? null : r.id))}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Icon
                    name={failed ? "x-circle" : "check-circle"}
                    size={16}
                    color={failed ? palette.destructive : palette.ok}
                  />
                  <T variant="body" weight="medium" style={{ flex: 1, minWidth: 0 }} numberOfLines={2}>
                    {titleOf(r)}
                  </T>
                  <Icon name={openId === r.id ? "chevron-down" : "chevron-right"} size={14} color={palette.faint} />
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 4, alignItems: "center" }}>
                  <T variant="micro" mono tone="faint">
                    {friendlyName(r.box)}
                  </T>
                  {secs ? (
                    <T variant="micro" mono tone="faint">
                      {durationWords(secs)}
                    </T>
                  ) : null}
                  {at ? (
                    <T variant="micro" tone="faint">
                      {ago(at)}
                    </T>
                  ) : null}
                </View>

                {openId === r.id ? (
                  <View style={{ marginTop: 10, gap: 8 }}>
                    <RunDetail id={r.id} />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Button
                        title="Run again"
                        variant="secondary"
                        small
                        onPress={() => router.push({ pathname: "/new", params: { task: r.task ?? "" } })}
                      />
                      <ArmButton title="Forget" armedTitle="Delete record?" small onConfirm={() => forget(r.id)} />
                    </View>
                  </View>
                ) : null}
              </Card>
            </FadeInUp>
          </React.Fragment>
        );
      })}
      {more ? (
        <Button title={loadingMore ? "Loading…" : "Show more"} variant="ghost" onPress={() => void showMore()} disabled={loadingMore} />
      ) : null}
    </View>
  );
}

/** The archived receipt, fetched once when a row opens. */
function RunDetail({ id }: { id: number }) {
  const [state, setState] = useState<"loading" | { digest: RunDigest | null }>("loading");
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    api
      .historyDetail(id)
      .then((r) => {
        if (!cancelled) setState({ digest: r.run.digest });
      })
      .catch(() => {
        if (!cancelled) setState({ digest: null });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state === "loading") return <CardSkeleton />;
  if (!state.digest) {
    return (
      <T variant="meta" tone="faint">
        No receipt was kept for this run — only the facts above.
      </T>
    );
  }
  return <DigestView digest={state.digest} />;
}

function titleOf(r: HistoryRun): string {
  const t = (r.task ?? "").trim();
  if (t) {
    const first = t.split("\n")[0];
    return first.length > 110 ? `${first.slice(0, 109)}…` : first;
  }
  return (r.headline ?? "").trim() || "Untitled run";
}

/** "Today" / "Yesterday" / "Mon 1 Sep" — the archive's day headers. Takes epoch MILLISECONDS. */
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" as const } : {}),
  });
}
