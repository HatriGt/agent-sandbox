import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import { api, type BoxView, type Me } from "@/lib/api";
import { ago, friendlyName, isSleeping, isUp } from "@/lib/format";
import { questionHeadline } from "@/lib/question";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { StatePill } from "@/components/ui/StatePill";
import { animateLayout, FadeInUp, PressScale, Skeleton, stagger } from "@/components/motion";
import { boxLabel, InboxChoices } from "@/components/BoxCard";

/* ───────────────────────────── Capacity ───────────────────────────── */

/**
 * The fleet's capacity as slots (web Capacity.tsx): one cell per slot, coloured by the machine in
 * it; an empty cell is a slot a new task can take right now.
 */
export function Capacity({ boxes, capacity }: { boxes: BoxView[]; capacity: number }) {
  const { palette } = useTheme();
  if (!capacity) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessibilityLabel="Loading capacity">
        <View style={{ flexDirection: "row", gap: 4 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width={12} height={8} />
          ))}
        </View>
        <Skeleton width={24} height={10} />
      </View>
    );
  }
  const live = boxes.filter((b) => isUp(b.boxStatus));
  const cells = Array.from({ length: Math.max(capacity, live.length) }, (_, i) => live[i] ?? null);
  const colorOf = (b: BoxView | null) => {
    if (!b) return palette.border;
    if (isSleeping(b.boxStatus)) return palette.sleep;
    switch (b.runState) {
      case "running":
        return palette.live;
      case "waiting":
        return palette.attention;
      case "done":
        return b.exitCode ? palette.destructive : palette.ok;
      default:
        return `${palette.live}73`;
    }
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessibilityLabel={`${live.length} of ${capacity} machines`}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {cells.map((b, i) => (
          <View key={b?.name ?? `free-${i}`} style={{ width: 12, height: 8, borderRadius: 3, backgroundColor: colorOf(b) }} />
        ))}
      </View>
      <T variant="micro" tone="muted" tnum>
        {live.length}/{capacity}
      </T>
    </View>
  );
}

/* ───────────────────────────── Get set up ───────────────────────────── */

const GS_KEY = "asb-gs-dismissed";

/** Read once per mount; null until known so the card never flashes in for someone who dismissed it. */
export function useGettingStartedDismissed(): [boolean | null, () => void] {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(GS_KEY).then((v) => setDismissed(v === "1"), () => setDismissed(false));
  }, []);
  const dismiss = () => {
    animateLayout();
    setDismissed(true);
    AsyncStorage.setItem(GS_KEY, "1").catch(() => {});
  };
  return [dismissed, dismiss];
}

/**
 * A fresh account's first screen (web GettingStarted.tsx): three things worth doing, each one tap
 * away, gone as soon as they are done or dismissed. Not a tour - a checklist that reflects real state.
 */
export function GettingStarted({ onDismiss, onFocusComposer }: { onDismiss: () => void; onFocusComposer: () => void }) {
  const { palette } = useTheme();
  const router = useRouter();
  const [accounts, setAccounts] = useState<number | null>(null);
  const [keys, setKeys] = useState<number | null>(null);
  useEffect(() => {
    api.accounts().then((r) => setAccounts(r.accounts.length)).catch(() => setAccounts(0));
    api.apiKeys().then((r) => setKeys(r.keys.filter((k) => !k.revoked_at).length)).catch(() => setKeys(0));
  }, []);
  const steps: { done: boolean; icon: IconName; title: string; body: string; cta: string; run: () => void }[] = [
    { done: (accounts ?? 0) > 0, icon: "github", title: "Connect a GitHub account", body: "So machines can clone your private repositories and open pull requests.", cta: "Integrations", run: () => router.push("/settings/integrations") },
    { done: false, icon: "zap", title: "Start your first task", body: "Describe it above in plain words, with a repo if it needs one. An agent works on it in a fresh sandbox, watched live, and you review the PR — diff, checks and merge — right here.", cta: "Focus the composer", run: onFocusComposer },
    { done: (keys ?? 0) > 0, icon: "link", title: "Connect your IDE", body: "Delegate from Cursor or Claude Code with a personal API key.", cta: "Connect", run: () => router.push("/settings/connect") },
  ];
  return (
    <FadeInUp>
      <View style={{ backgroundColor: palette.card, borderRadius: radius.xl, borderWidth: 1, borderColor: palette.border, padding: 16, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="h3" weight="semibold">
              Get set up
            </T>
            <T variant="meta" tone="muted">
              Three things, each optional, each a tap away.
            </T>
          </View>
          <PressScale onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss" style={{ padding: 4 }}>
            <Icon name="x" size={16} color={palette.faint} />
          </PressScale>
        </View>
        {steps.map((s, i) => (
          <FadeInUp key={s.title} delay={stagger(i, 50)}>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", padding: 10, borderRadius: radius.lg, backgroundColor: s.done ? "transparent" : palette.muted, borderWidth: s.done ? 1 : 0, borderColor: palette.border }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: s.done ? `${palette.ok}1f` : palette.background, alignItems: "center", justifyContent: "center" }}>
                <Icon name={s.done ? "check" : s.icon} size={13} color={s.done ? palette.ok : palette.mutedForeground} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T variant="meta" weight="medium" tone={s.done ? "muted" : "default"}>
                  {s.title}
                </T>
                <T variant="micro" tone={s.done ? "faint" : "muted"}>
                  {s.body}
                </T>
                {s.done ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <Icon name="check" size={11} color={palette.ok} />
                    <T variant="micro" weight="medium" tone="ok">
                      Done
                    </T>
                  </View>
                ) : (
                  <PressScale onPress={s.run} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, alignSelf: "flex-start" }}>
                    <T variant="micro" weight="medium" tone="live">
                      {s.cta}
                    </T>
                    <Icon name="arrow-right" size={11} color={palette.live} />
                  </PressScale>
                )}
              </View>
            </View>
          </FadeInUp>
        ))}
      </View>
    </FadeInUp>
  );
}

/* ───────────────────────────── Trial ───────────────────────────── */

export const SELF_HOST_URL = "https://github.com/HatriGt/agent-sandbox/blob/main/docs/self-hosting.md";
export const UPGRADE_FALLBACK_URL = "mailto:hello@agent-sandbox.dev?subject=Agent%20Sandbox%20upgrade";

/**
 * One wording for the plan everywhere: `badge` is the short line on the Settings account row,
 * `title` + `body` the plan card in Account and the hard stop on Home.
 */
export function trialCopy(user: Extract<Me, { kind: "user" }>): { badge: string; title: string; body: string } {
  if (user.plan === "pro") return { badge: "Pro", title: "Pro", body: "Unlimited time. Thank you." };
  if (user.expired) {
    return { badge: "Trial ended", title: "Trial ended", body: "Your runs, GitHub accounts and MCP servers are kept. Upgrade to keep starting machines — or self-host for free." };
  }
  const left = user.daysLeft === 0 ? "ends today" : `${user.daysLeft ?? "?"} day${user.daysLeft === 1 ? "" : "s"} left`;
  const ends = user.trialEndsAt ? ` · ends ${new Date(user.trialEndsAt).toLocaleDateString()}` : "";
  return { badge: `Trial · ${left}`, title: "Free trial", body: `${left[0].toUpperCase()}${left.slice(1)}${ends} · no card on file` };
}

/** The hard stop (web TrialBadge.tsx TrialEndedNotice): shown above the composer once the trial is over. */
export function TrialEndedNotice() {
  const { palette } = useTheme();
  const { me } = useAuth();
  if (me?.kind !== "user" || !me.expired) return null;
  const { title, body } = trialCopy(me);
  return (
    <FadeInUp>
      <View style={{ backgroundColor: palette.card, borderRadius: radius.xl, borderWidth: 1, borderColor: palette.border, borderLeftWidth: 3, borderLeftColor: palette.attention, padding: 14, gap: 10 }} accessibilityRole="alert">
        <View style={{ gap: 2 }}>
          <T variant="meta" weight="medium">
            {title}
          </T>
          <T variant="meta" tone="muted">
            {body}
          </T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Button title="Upgrade" small onPress={() => void WebBrowser.openBrowserAsync(me.billingUrl ?? UPGRADE_FALLBACK_URL)} />
        </View>
      </View>
    </FadeInUp>
  );
}

/* ───────────────────────────── Live now row ───────────────────────────── */
/**
 * A compact "Live now" row (web Hub.tsx): state pill, the question headline for a waiting run or
 * the thread title, "last action {ago}", the machine name; inline quick answers under a question.
 */
export function LiveRow({ box, last, onOpen, onLongPress }: { box: BoxView; last: boolean; onOpen: () => void; onLongPress: () => void }) {
  const { palette } = useTheme();
  const waiting = box.runState === "waiting";
  const title = waiting && box.question ? questionHeadline(box.question) : boxLabel(box);
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: palette.border }}>
      <PressScale
        onPress={onOpen}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint="Double tap to open. Double tap and hold for more actions."
        style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 10, gap: 4, backgroundColor: pressed ? palette.muted : "transparent" })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <StatePill runState={box.runState} boxStatus={box.boxStatus} exitCode={box.exitCode} />
          <T variant="meta" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {title}
          </T>
          <Icon name="chevron-right" size={14} color={palette.faint} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 2 }}>
          {box.lastOutputAt ? (
            <T variant="micro" tone={box.stalled ? "destructive" : "faint"} tnum>
              {box.runState === "running" ? "last action " : ""}
              {ago(box.lastOutputAt * 1000)}
            </T>
          ) : null}
          <T variant="micro" mono tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {friendlyName(box.name)}
          </T>
        </View>
      </PressScale>
      {waiting && box.question ? <InboxChoices box={box.name} question={box.question} amber={false} style={{ marginTop: 0, paddingHorizontal: 14, paddingBottom: 10 }} /> : null}
    </View>
  );
}
