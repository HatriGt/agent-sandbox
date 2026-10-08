import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api, type ThreadScheduleItem, type ThreadScheduleReject } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { ArmButton } from "./ui/ArmButton";
import { Button } from "./ui/Button";
import { Icon, type IconName } from "./ui/Icon";
import { PressScale } from "@/components/motion";
import { useNow } from "@/hooks/useNow";

/**
 * What this chat scheduled (web: thread/ScheduledCard + SchedulePill). One compact card with a row
 * per schedule, grouped by relation. A proposal awaiting approval carries the "needs you" treatment
 * from the recent web theme — an ink hairline with a soft halo and exactly one filled button — never
 * amber. A schedule the agent wrote but the controller could not read is listed too, with a one-tap
 * way to ask again (copied into the clipboard for the composer; it has no prefill hook yet).
 */

type Item = ThreadScheduleItem;

export const CATEGORY: Record<Item["category"], { label: string; icon: IconName }> = {
  ci: { label: "CI", icon: "git-pull-request" },
  deploy: { label: "Deploy", icon: "upload-cloud" },
  monitor: { label: "Monitor", icon: "activity" },
  report: { label: "Report", icon: "file-text" },
  "follow-up": { label: "Follow-up", icon: "bell" },
  maintenance: { label: "Upkeep", icon: "tool" },
  task: { label: "Task", icon: "disc" },
};

const GROUP_LABEL: Record<Item["relation"], string> = {
  proposed: "Waiting for your approval",
  created: "Scheduled from this chat",
  repeats: "The schedule that started this chat",
  after: "Runs after this chat's automation",
};
const GROUP_ORDER: Item["relation"][] = ["proposed", "created", "repeats", "after"];

const STATUS_LABEL: Record<Item["status"], string> = {
  "needs-ok": "Pending",
  waiting: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  paused: "Paused",
  cancelled: "Cancelled",
};

const POLL_MS = 30_000;

/** "in 12 min" · "today 3:00 pm" · "tomorrow 9:00 am" · "Tue 2:00 am" · "12 Oct" (web: SchedulePill.fmtNext). */
export function fmtNext(at: number, now = Date.now()): string {
  const d = new Date(at);
  const mins = Math.round((at - now) / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(new Date(now))) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function exact(at: number): string {
  return new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function whenLine(it: Item, now: number): string {
  if (it.relation === "proposed") return it.at ? `Runs once · ${exact(it.at)}` : it.when;
  switch (it.status) {
    case "done":
      return `Done${it.lastFired ? ` · ${ago(it.lastFired)}` : ""}`;
    case "failed":
      return `Failed${it.lastOutcome ? ` · ${it.lastOutcome}` : ""}`;
    case "running":
      return "Running now";
    case "cancelled":
      return "Cancelled";
    case "paused":
      return `Paused · ${it.when}`;
    default:
      if (it.at) return `Runs once · ${exact(it.at)} · ${fmtNext(it.at, now)}`;
      return it.nextFire !== null ? `${it.when} · next ${fmtNext(it.nextFire, now)}` : it.when;
  }
}

/** Fetch on mount, on every run-state settle (done/waiting), on focus, and on a slow poll while focused. */
export function useThreadSchedules(box: string, runState: string | undefined) {
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<ThreadScheduleReject[]>([]);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!box) return;
    try {
      const r = await api.threadSchedules(box);
      if (!alive.current) return;
      setItems(r.items);
      setRejected(r.rejected ?? []);
    } catch {
      /* keep the last good list */
    }
  }, [box]);

  useEffect(() => {
    alive.current = true;
    setItems([]);
    setRejected([]);
    return () => {
      alive.current = false;
    };
  }, [box]);

  const settled = runState === "done" || runState === "waiting";
  useEffect(() => {
    void load();
  }, [load, settled]);

  // Poll while this screen is focused and the app is foregrounded — on the shared 30s tick.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const tick = useNow(POLL_MS, focused);
  useEffect(() => {
    if (!focused) return;
    if (AppState.currentState === "active") void load();
  }, [load, focused, tick]);

  return { items, rejected, reload: load };
}

export function ScheduledCard({
  box,
  runState,
  onPrefill,
  onNote,
}: {
  box: string;
  runState: string | undefined;
  /** Put text in the composer (not wired on mobile yet — falls back to the clipboard). */
  onPrefill?: (text: string) => void;
  onNote?: (text: string) => void;
}) {
  const { palette } = useTheme();
  const { items, rejected, reload } = useThreadSchedules(box, runState);
  const now = useNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A reject that later got scheduled correctly (the agent tried again) is no longer news.
  const failed = runState !== "running" ? rejected.filter((r) => !items.some((i) => i.task === r.task)) : [];
  if (items.length === 0 && failed.length === 0) return null;

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const retry = async (r: ThreadScheduleReject) => {
    const text = `Schedule this again with an exact time (for example "in 5d" or an ISO date): ${r.task}`;
    if (onPrefill) return onPrefill(text);
    try {
      await Clipboard.setStringAsync(text);
      onNote?.("Copied a retry request — paste it into the composer to ask again.");
    } catch (e) {
      onNote?.(e instanceof Error ? e.message : String(e));
    }
  };

  const pending = items.filter((i) => i.relation === "proposed").length;
  const groups = GROUP_ORDER.map((rel) => ({ rel, rows: items.filter((i) => i.relation === rel) })).filter((g) => g.rows.length);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
        <Icon name="calendar" size={12} color={pending ? palette.foreground : palette.faint} />
        <T variant="micro" weight="semibold" tone={pending ? "default" : "faint"} style={{ letterSpacing: 0.4 }}>
          {pending > 0 ? (pending === 1 ? "SCHEDULED — WAITING FOR YOUR APPROVAL" : `SCHEDULED — ${pending} WAITING FOR YOUR APPROVAL`) : "SCHEDULED"}
        </T>
      </View>
      {error ? (
        <T variant="micro" tone="destructive">
          {error}
        </T>
      ) : null}
      {groups.map((g) => (
        <View key={g.rel} style={{ gap: 6 }}>
          {g.rel !== "proposed" ? (
            <T variant="micro" tone="faint" style={{ paddingHorizontal: 2 }}>
              {GROUP_LABEL[g.rel]}
            </T>
          ) : null}
          {g.rows.map((it) =>
            it.relation === "proposed" ? (
              <ProposedRow key={it.id} it={it} busy={busy === it.id} run={run} />
            ) : (
              <Row key={it.id} it={it} now={now} busy={busy === it.id} run={run} />
            ),
          )}
        </View>
      ))}
      {failed.map((r) => (
        <View
          key={`${r.when}|${r.task}`}
          style={{
            borderWidth: 1,
            borderColor: `${palette.destructive}66`,
            borderRadius: radius.xl,
            padding: 12,
            gap: 8,
          }}
        >
          <T variant="body" weight="medium" numberOfLines={2}>
            {r.task.split(/[.!?](?=\s|$)/)[0].trim()}
          </T>
          <T variant="meta" tone="muted">
            Not scheduled — {r.reason}.
          </T>
          <Button title="Ask again" variant="outline" small onPress={() => void retry(r)} style={{ alignSelf: "flex-start" }} />
        </View>
      ))}
    </View>
  );
}

type Run = (id: string, fn: () => Promise<unknown>) => Promise<void>;

/** Needs you: ink hairline, a soft halo ring, one filled button. */
function ProposedRow({ it, busy, run }: { it: Item; busy: boolean; run: Run }) {
  const { palette } = useTheme();
  const cat = CATEGORY[it.category];
  return (
    <View style={{ borderWidth: 3, borderColor: `${palette.foreground}14`, borderRadius: radius.xl + 3 }}>
      <View
        style={{
          backgroundColor: palette.card,
          borderWidth: 1,
          borderColor: `${palette.foreground}80`,
          borderRadius: radius.xl,
          padding: 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={cat.icon} size={12} color={palette.mutedForeground} />
          <T variant="micro" tone="muted" weight="medium">
            {cat.label}
          </T>
        </View>
        <T variant="body" weight="medium">
          {it.name}
        </T>
        <T variant="meta" tone="muted">
          {whenLine(it, Date.now())}
        </T>
        <T variant="micro" tone="muted">
          {it.why ?? "The agent asked you to confirm it first"}. It stays paused until you approve.
        </T>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
          <Button title="Dismiss" variant="ghost" small disabled={busy} onPress={() => void run(it.id, () => api.deleteAutomation(it.id))} />
          <Button
            title={busy ? "Approving…" : "Approve"}
            variant="primary"
            small
            loading={busy}
            onPress={() => void run(it.id, () => api.setAutomationEnabled(it.id, true))}
          />
        </View>
      </View>
    </View>
  );
}

function Row({ it, now, busy, run }: { it: Item; now: number; busy: boolean; run: Run }) {
  const { palette } = useTheme();
  const cat = CATEGORY[it.category];
  const over = it.status === "done" || it.status === "cancelled";
  // A one-off that already fired cannot meaningfully run again.
  const canRunNow = !(it.at && it.lastFired !== null);
  const statusTone = it.status === "failed" ? "destructive" : it.status === "running" ? "live" : "muted";
  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: radius.xl,
        padding: 12,
        gap: 8,
        opacity: over || (!it.enabled && !busy) ? 0.7 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={cat.icon} size={12} color={palette.mutedForeground} />
        <T variant="micro" tone="muted" weight="medium" style={{ flex: 1 }}>
          {cat.label}
        </T>
        <T variant="micro" weight="medium" tone={statusTone}>
          {STATUS_LABEL[it.status]}
        </T>
      </View>
      <T variant="body" weight="medium" numberOfLines={2}>
        {it.name}
      </T>
      <T variant="meta" tone={it.status === "failed" ? "destructive" : "muted"}>
        {whenLine(it, now)}
      </T>
      <View style={{ flexDirection: "row", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        {!over ? (
          <PressScale disabled={busy} hitSlop={6} onPress={() => void run(it.id, () => api.setAutomationEnabled(it.id, !it.enabled))} style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Icon name={it.enabled ? "pause" : "play"} size={12} color={palette.foreground} />
              <T variant="micro" weight="medium">
                {it.enabled ? "Pause" : "Resume"}
              </T>
            </View>
          </PressScale>
        ) : null}
        {canRunNow ? (
          <PressScale disabled={busy} hitSlop={6} onPress={() => void run(it.id, () => api.runAutomation(it.id))} style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Icon name="zap" size={12} color={palette.foreground} />
              <T variant="micro" weight="medium">
                {busy ? "Working…" : "Run now"}
              </T>
            </View>
          </PressScale>
        ) : null}
        <View style={{ flex: 1 }} />
        <ArmButton title="Delete" armedTitle="Delete it?" variant="ghost" small disabled={busy} onConfirm={() => run(it.id, () => api.deleteAutomation(it.id))} />
      </View>
    </View>
  );
}
