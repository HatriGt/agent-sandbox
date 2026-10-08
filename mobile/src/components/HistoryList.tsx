import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, FlatList, View, type StyleProp, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { api, ledgerApi, type LedgerRow, type LedgerTotals, type RunDigest } from "@/lib/api";
import { ago, durationWords, friendlyName } from "@/lib/format";
import { composeTask } from "@/state/composerFocus";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { ArmButton } from "./ui/ArmButton";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { SwipeRow } from "./ui/SwipeRow";
import { DigestView } from "./DigestCard";
import { OutcomeView, outcomeFacts } from "./OutcomeCard";
import { Segmented as Chips } from "./settings/Segmented";
import { animateLayout, CardSkeleton, DUR, EASE_OUT, FadeInUp, isReducedMotion, Skeleton, stagger } from "@/components/motion";

const PAGE = 25;

/**
 * History: finished runs kept by the server after their machines are gone (src/run-archive.ts).
 * Deliberately still — fetched once, no polling; the live picture lives on Fleet and the Activity
 * tab. A row expands into the archived receipt, and offers exactly two actions: run the same brief
 * again on a new machine, or forget the record.
 */
type Filter = "all" | "done" | "failed";

export function HistoryList({ header, contentContainerStyle }: { header: React.ReactElement; contentContainerStyle?: StyleProp<ViewStyle> }) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [totals, setTotals] = useState<LedgerTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    ledgerApi({ limit: PAGE })
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
        setTotals(r.totals);
        setMore(r.rows.length === PAGE);
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
      const r = await ledgerApi({ limit: PAGE, before: rows[rows.length - 1].id });
      setRows((prev) => [...(prev ?? []), ...r.rows]);
      setMore(r.rows.length === PAGE);
    } catch {
      // A failed page leaves the loaded ones alone; the button stays for another try.
    } finally {
      setLoadingMore(false);
    }
  }, [rows]);

  const forget = useCallback(async (id: number) => {
    try {
      await api.historyDelete(id);
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    } catch {
      // Nothing removed — the row stays, which is the honest picture.
    }
  }, []);
  const toggle = useCallback((id: number) => {
    animateLayout();
    setOpenId((cur) => (cur === id ? null : id));
  }, []);
  // Chip counts come from the ledger totals (the whole archive, not just the loaded page).
  const counts = { all: totals?.runs ?? (rows ?? []).length, done: totals ? totals.runs - totals.failed : 0, failed: totals?.failed ?? 0 };
  const visible = useMemo(() => (filter === "all" ? (rows ?? []) : (rows ?? []).filter((r) => r.state === filter)), [rows, filter]);
  // Day headers precomputed once per page load, not re-derived inside every row render.
  const heads = useMemo(() => {
    const out: (string | null)[] = [];
    let prev: string | null = null;
    for (const r of visible) {
      const at = r.archivedAt || r.endedAt || 0;
      const label = at ? dayLabel(at) : null;
      out.push(label && label !== prev ? label : null);
      if (label) prev = label;
    }
    return out;
  }, [visible]);
  const renderItem = useCallback(
    ({ item, index }: { item: LedgerRow; index: number }) => (
      <HistoryRow r={item} i={index} head={heads[index]} open={openId === item.id} onToggle={toggle} onForget={forget} />
    ),
    [heads, openId, toggle, forget],
  );

  return (
    <FlatList
      data={visible}
      keyExtractor={(r) => String(r.id)}
      renderItem={renderItem}
      extraData={openId}
      initialNumToRender={10}
      windowSize={9}
      contentContainerStyle={contentContainerStyle}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          {header}
          {totals?.runs ? <LedgerHeader t={totals} /> : null}
          {rows?.length ? (
            <Chips
              small
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `All ${counts.all}` },
                { value: "done", label: `Done ${counts.done}` },
                { value: "failed", label: `Failed ${counts.failed}` },
              ]}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        error ? (
          <T variant="body" tone="destructive">
            Could not load history: {error}
          </T>
        ) : rows === null ? (
          <View style={{ gap: 10 }}>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </View>
        ) : rows.length === 0 ? (
          <T variant="body" tone="muted">
            When a run finishes, its receipt is kept here — even after the machine is reaped. Nothing yet.
          </T>
        ) : (
          <T variant="body" tone="muted">
            {`No ${filter} runs loaded.`} {more ? "Load more to look further back." : ""}
          </T>
        )
      }
      ListFooterComponent={
        more ? <Button title={loadingMore ? "Loading…" : "Show more"} variant="ghost" onPress={() => void showMore()} disabled={loadingMore} /> : null
      }
    />
  );
}

/** One archived run. Memoized: toggling a row or paging in more re-renders only the rows that changed. */
const HistoryRow = memo(function HistoryRow({
  r,
  i,
  head,
  open,
  onToggle,
  onForget,
}: {
  r: LedgerRow;
  i: number;
  head: string | null;
  open: boolean;
  onToggle: (id: number) => void;
  onForget: (id: number) => void;
}) {
  const router = useRouter();
  const { palette } = useTheme();
  const at = r.archivedAt || r.endedAt || 0;
  const failed = r.state === "failed";
  const verified = r.verified === true || /\bverified\s*$/i.test(r.headline ?? "");
  const tokens = tokensOf(r);
  const facts = r.outcome ? outcomeFacts(r.outcome) : "";
  // Archive stamps are epoch ms; durationWords speaks seconds, ago speaks ms.
  const secs = r.startedAt && r.endedAt && r.endedAt > r.startedAt ? Math.round((r.endedAt - r.startedAt) / 1000) : null;
  // Chevron turns to point down as the row opens, instead of swapping glyphs.
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    if (isReducedMotion()) {
      turn.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: DUR.fast, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [open, turn]);
  // Swipe-to-forget keeps the arm/confirm step: the first tap arms the revealed action, the second
  // (within 4s) deletes. Same contract as the ArmButton inside the open row.
  const [armed, setArmed] = useState(false);
  const disarm = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(disarm.current), []);
  const swipeForget = () => {
    if (!armed) {
      setArmed(true);
      disarm.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    clearTimeout(disarm.current);
    setArmed(false);
    onForget(r.id);
  };
  return (
    <>
      {head ? (
        <T variant="micro" tone="faint" weight="semibold" style={{ marginTop: i === 0 ? 0 : 6 }}>
          {head.toUpperCase()}
        </T>
      ) : null}
      <FadeInUp delay={stagger(i)}>
        <SwipeRow actions={[{ label: armed ? "Delete?" : "Forget", icon: "trash-2", tone: "destructive", stayOpen: !armed, onPress: swipeForget }]}>
        <Card onPress={() => onToggle(r.id)}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <T variant="micro" mono tone="faint" style={{ flexShrink: 0 }} accessibilityLabel={`Run number ${r.id}`}>
              #{r.id}
            </T>
            <T variant="body" weight="medium" style={{ flex: 1, minWidth: 0 }} numberOfLines={2}>
              {titleOf(r)}
            </T>
            <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] }) }] }}>
              <Icon name="chevron-right" size={14} color={palette.faint} />
            </Animated.View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6, alignItems: "center" }}>
            <Chip tone={failed ? "destructive" : "ok"} label={failed ? "failed" : "done"} />
            {verified ? <Chip tone="ok" label="✓ verified" /> : null}
            <T variant="micro" mono tone="faint">
              {friendlyName(r.box)}
            </T>
            {secs ? (
              <T variant="micro" mono tone="faint">
                {durationWords(secs)}
              </T>
            ) : null}
            <T variant="micro" mono tone={tokens != null ? "muted" : "faint"} accessibilityLabel={tokens != null ? `${r.inputTokens ?? 0} in, ${r.outputTokens ?? 0} out` : "tokens not reported"}>
              {tokens != null ? `${fmtTokens(tokens)} tok` : "— tok"}
              {r.costUsd != null ? ` · ${fmtUsd(r.costUsd)}` : ""}
            </T>
            {at ? (
              <T variant="micro" tone="faint">
                {ago(at)}
              </T>
            ) : null}
          </View>

          {r.outcome?.header.label || facts ? (
            <T variant="micro" mono tone="muted" numberOfLines={1} style={{ marginTop: 4 }}>
              {[r.outcome?.header.label, facts].filter(Boolean).join(" · ")}
            </T>
          ) : null}

          {open ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              {r.outcome ? <OutcomeView outcome={r.outcome} /> : null}
              <RunDetail id={r.id} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button
                  title="Run again"
                  variant="secondary"
                  small
                  onPress={() => composeTask({ task: r.task ?? "" })}
                />
                <ArmButton title="Forget" armedTitle="Delete record?" small onConfirm={() => onForget(r.id)} />
              </View>
            </View>
          ) : null}
        </Card>
        </SwipeRow>
      </FadeInUp>
    </>
  );
});

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

  if (state === "loading") {
    return (
      <View style={{ gap: 8 }}>
        <Skeleton width="70%" height={12} />
        <Skeleton width="90%" height={10} />
        <Skeleton width="55%" height={10} />
      </View>
    );
  }
  if (!state.digest) {
    return (
      <T variant="meta" tone="faint">
        No receipt was kept for this run — only the facts above.
      </T>
    );
  }
  return <DigestView digest={state.digest} />;
}

function titleOf(r: LedgerRow): string {
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

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
const fmtUsd = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const tokensOf = (r: LedgerRow) => (r.inputTokens != null || r.outputTokens != null ? (r.inputTokens ?? 0) + (r.outputTokens ?? 0) : null);

/** Totals over the whole archive — runs, outcomes, checks, tokens, reported cost (never estimated). */
function LedgerHeader({ t }: { t: LedgerTotals }) {
  const { palette } = useTheme();
  const cells: [string, string][] = [
    ["Runs", String(t.runs)],
    ["Done", String(t.done)],
    ["Failed", String(t.failed)],
    ...(t.checked ? [["Checks passed", `${t.passed}/${t.checked}`] as [string, string]] : []),
    ...(t.withUsage ? [["Tokens", `${fmtTokens(t.inputTokens)} in · ${fmtTokens(t.outputTokens)} out`] as [string, string]] : []),
    ...(t.costUsd != null ? [["Cost", `${fmtUsd(t.costUsd)}${t.withCost < t.runs ? ` from ${t.withCost} priced runs` : ""}`] as [string, string]] : []),
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 4 }}>
      {cells.map(([k, v]) => (
        <View key={k} style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
          <T variant="micro" tone="faint">
            {k}
          </T>
          <T variant="meta" weight="semibold">
            {v}
          </T>
        </View>
      ))}
    </View>
  );
}

/** Outcome chip — the web StatusDot: dot + word, tone-coloured. */
function Chip({ tone, label }: { tone: "ok" | "destructive"; label: string }) {
  const { palette } = useTheme();
  const color = tone === "ok" ? palette.ok : palette.destructive;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, height: 20, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <T variant="micro" weight="medium" style={{ color }}>
        {label}
      </T>
    </View>
  );
}
