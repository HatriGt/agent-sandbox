import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { api, type BoxView, type RepoInfo } from "@/lib/api";
import { parseTrace } from "@/lib/trace";
import { toMarkdown } from "@/lib/transcript-tools";
import { serverUrl } from "@/lib/config";
import { currentDiskTier, fmtMib, isSleeping, offerableTiers, usageLevel, type Usage } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Icon, type IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { UsageMeter } from "../ui/UsageMeter";

/** "812 MB used · 3.2 GB free" — the sentence under a vitals meter. */
function usageWords(u: Usage): string {
  const free = Math.max(0, u.totalMib - u.usedMib);
  return `${fmtMib(u.usedMib)} used · ${fmtMib(free)} free of ${fmtMib(u.totalMib)}`;
}

/**
 * One vitals row: label, meter against the cap, and the used/free sentence.
 *
 * Full width, stacked — not two columns. Half a sheet cannot hold an icon, a track, a `812 MB/1.0 GB`
 * mono label and a "used · free of" sentence without the text escaping the card on a narrow phone.
 */
function VitalRow({ kind, label, usage }: { kind: "memory" | "disk"; label: string; usage: Usage | undefined }) {
  if (!usage || !(usage.totalMib > 0)) return null;
  const level = usageLevel(usage);
  return (
    <View style={{ gap: 4 }}>
      <T variant="micro" tone="faint" weight="semibold">
        {label}
      </T>
      <UsageMeter kind={kind} usage={usage} fluid />
      <T
        variant="micro"
        numberOfLines={1}
        tone={level === "critical" ? "destructive" : level === "high" ? "attention" : "muted"}
      >
        {usageWords(usage)}
      </T>
    </View>
  );
}

/**
 * Live vitals for the ⋯ menu: how much RAM and disk the box is using and what's left. Only while
 * awake — a sleeping box reports no metrics, so we say that instead of showing a frozen number.
 */
function VitalsBlock({ box, sleeping, border }: { box: BoxView; sleeping: boolean; border: string }) {
  const hasAny = !!(box.memUsage || box.disk);
  return (
    <View style={{ borderWidth: 1, borderColor: border, borderRadius: radius.xl, padding: 12, marginBottom: 8 }}>
      {sleeping || !hasAny ? (
        <T variant="micro" tone="faint">
          {sleeping ? "Asleep — memory and disk usage report once it wakes." : "No usage metrics reported yet."}
        </T>
      ) : (
        <View style={{ gap: 12 }}>
          <VitalRow kind="memory" label="MEMORY" usage={box.memUsage} />
          <VitalRow kind="disk" label="STORAGE" usage={box.disk} />
        </View>
      )}
    </View>
  );
}

/** One row of the actions menu: icon tile + label + hint, web ⋯-menu style. */
function ActionRow({
  icon,
  label,
  hint,
  destructive,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const color = destructive ? palette.destructive : disabled ? palette.faint : palette.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 4,
        opacity: pressed ? 0.6 : disabled ? 0.45 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: destructive ? `${palette.destructive}1a` : palette.secondary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={16} color={destructive ? palette.destructive : palette.mutedForeground} />
      </View>
      {/* minWidth:0 is what actually lets a flex child shrink below its content width in RN —
          without it a long hint pushes the chevron off the sheet instead of ellipsising. */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="body" weight="medium" numberOfLines={1} style={{ color }}>
          {label}
        </T>
        {hint ? (
          <T variant="micro" tone="faint" numberOfLines={2}>
            {hint}
          </T>
        ) : null}
      </View>
      <View style={{ flexShrink: 0 }}>
        <Icon name="chevron-right" size={15} color={palette.faint} />
      </View>
    </Pressable>
  );
}

type Pane = "menu" | "rename" | "attach" | "destroy" | "memory" | "disk";

/**
 * The box's current memory cap, as a tier label. There is no dedicated field: `mem` is the MEM column
 * of `msb metrics` ("1009.6 MiB / 1.0 GiB") and the denominator IS the cap. A sleeping box has no
 * metrics, so the caller's fallback (the deployment default) stands in. Mirrors
 * web/src/lib/lifecycle.ts:currentMemoryTier.
 */
export function currentMemoryTier(mem: string | undefined, fallback?: string): string | undefined {
  const denom = (mem ?? "").split("/")[1]?.trim();
  const m = /^(\d+(?:\.\d+)?)\s*(gib|gb|g|mib|mb|m)$/i.exec(denom ?? "");
  if (!m) return fallback;
  const gb = /^m/i.test(m[2]) ? Number(m[1]) / 1024 : Number(m[1]);
  const whole = Math.round(gb);
  return whole >= 1 ? `${whole}G` : fallback;
}

/** Machine controls, mirroring the web thread's ⋯ menu. */
export function BoxActionsSheet({
  box,
  log,
  memoryTiers,
  memoryDefault,
  diskTiers,
  visible,
  onClose,
  onChanged,
  onDestroyed,
  onRunAgain,
  onSlept,
}: {
  box: BoxView | null;
  log?: string;
  /** Memory tiers the machine may be resized to (from /fleet.json). Omit to hide the control. */
  memoryTiers?: string[];
  memoryDefault?: string;
  /** Root-disk tiers, unfiltered — a disk can only grow, so the sheet filters them itself. */
  diskTiers?: string[];
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDestroyed?: () => void;
  onRunAgain?: () => void;
  /** The operator chose "Sleep now" — the thread must not auto-wake the box right back up. */
  onSlept?: () => void;
}) {
  const { palette } = useTheme();
  const [pane, setPane] = useState<Pane>("menu");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [repoHits, setRepoHits] = useState<RepoInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setPane("menu");
      setNote(null);
    }
  }, [visible]);

  useEffect(() => {
    if (pane !== "attach") return;
    const t = setTimeout(() => {
      api.repos(repoQuery).then((r) => setRepoHits(r.repos.slice(0, 6))).catch(() => setRepoHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [pane, repoQuery]);

  if (!box) return null;
  const sleeping = isSleeping(box.boxStatus);
  const running = box.runState === "running";
  const memTier = currentMemoryTier(box.mem, memoryDefault);
  const diskTier = currentDiskTier(box.disk, diskTiers);
  // Grow-only: `msb modify --root-disk` cannot shrink a managed disk, so a smaller pick could only
  // ever fail at the runtime with a confusing error. Offer sizes at or above the current one.
  const growTiers = offerableTiers(diskTiers, diskTier, true);

  const act = async (fn: () => Promise<unknown>, done?: () => void) => {
    setNote(null);
    setBusy(true);
    try {
      await fn();
      onChanged();
      done?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const titleText =
    pane === "rename"
      ? "Rename"
      : pane === "attach"
        ? "Attach a repository"
        : pane === "destroy"
          ? "Destroy machine?"
          : pane === "memory"
            ? "Memory"
            : pane === "disk"
              ? "Storage"
              : box.title || box.name;

  return (
    <Sheet visible={visible} onClose={pane === "menu" ? onClose : () => setPane("menu")} title={titleText}>
      <View style={{ paddingBottom: 12 }}>
        {note ? (
          <T variant="meta" tone="muted" style={{ marginBottom: 8 }}>
            {note}
          </T>
        ) : null}

        {pane === "menu" && (
          <>
            <VitalsBlock box={box} sleeping={sleeping} border={palette.border} />
            <ActionRow
              icon={box.kept ? "bookmark" : "bookmark"}
              label={box.kept ? "Release" : "Keep"}
              hint={box.kept ? "kept — sleeps · auto-destroyed after release" : "never reaped while asleep"}
              onPress={() => act(() => api.keep(box.name, !box.kept))}
            />
            <ActionRow icon="edit-2" label="Rename" disabled={!box.task} onPress={() => setPane("rename")} />
            <ActionRow
              icon="git-branch"
              label="Attach a repository"
              hint="cloned into /workspace; the agent is told next turn"
              disabled={sleeping}
              onPress={() => setPane("attach")}
            />
            <ActionRow
              icon="link"
              label="Copy link"
              hint="opens this thread in the web dashboard"
              onPress={async () => {
                await Clipboard.setStringAsync(`${serverUrl()}/dashboard/box/${encodeURIComponent(box.name)}`);
                setNote("Link copied.");
              }}
            />
            {log ? (
              <ActionRow
                icon="copy"
                label="Copy transcript"
                hint="Markdown"
                onPress={async () => {
                  await Clipboard.setStringAsync(
                    toMarkdown(parseTrace(log), { title: box.title || box.task?.split("\n")[0] || box.name, machine: box.name }),
                  );
                  setNote("Transcript copied as Markdown.");
                }}
              />
            ) : null}
            {onRunAgain && box.task ? (
              <ActionRow icon="refresh-cw" label="Run again" hint="new machine, same brief" onPress={onRunAgain} />
            ) : null}
            <ActionRow
              icon={sleeping ? "sun" : "moon"}
              label={sleeping ? "Wake" : "Sleep now"}
              hint={sleeping ? "restores the workspace and session" : running ? "busy — finish first" : "a reply wakes it"}
              disabled={!sleeping && running}
              onPress={() =>
                act(
                  () => (sleeping ? api.wake(box.name) : api.sleep(box.name).then((r) => (onSlept?.(), r))),
                  onClose,
                )
              }
            />
            {memoryTiers?.length ? (
              <ActionRow
                icon="cpu"
                label="Memory"
                hint={
                  running
                    ? "busy — finish first"
                    : box.memUsage
                      ? `${fmtMib(box.memUsage.usedMib)} of ${fmtMib(box.memUsage.totalMib)} used · resize reboots`
                      : memTier
                        ? `${memTier} · a change reboots the machine`
                        : "a change reboots the machine"
                }
                disabled={running}
                onPress={() => setPane("memory")}
              />
            ) : null}
            {growTiers.length ? (
              <ActionRow
                icon="hard-drive"
                label="Storage"
                hint={
                  running
                    ? "busy — finish first"
                    : box.disk
                      ? `${fmtMib(box.disk.usedMib)} of ${fmtMib(box.disk.totalMib)} used · grow reboots`
                      : diskTier
                        ? `${diskTier} · a change reboots the machine`
                        : "a change reboots the machine"
                }
                disabled={running}
                onPress={() => setPane("disk")}
              />
            ) : null}
            <View style={{ height: 1, backgroundColor: palette.border, marginVertical: 6 }} />
            <ActionRow icon="trash-2" label="Destroy machine…" destructive onPress={() => setPane("destroy")} />
          </>
        )}

        {pane === "memory" && (
          <View style={{ gap: 4 }}>
            <T variant="meta" tone="muted" style={{ marginBottom: 4 }}>
              This runtime cannot resize memory live, so picking a size reboots the machine. The
              workspace, checkouts and the agent&apos;s session are kept — expect it back in about half a
              minute.
            </T>
            {(memoryTiers ?? []).map((t) => (
              <ActionRow
                key={t}
                icon="cpu"
                label={t}
                hint={t === memTier ? "current" : "restart with this size"}
                disabled={busy || t === memTier}
                onPress={() => act(() => api.setMemory(box.name, t), onClose)}
              />
            ))}
            <Button title="Cancel" variant="secondary" onPress={() => setPane("menu")} disabled={busy} />
          </View>
        )}

        {pane === "disk" && (
          <View style={{ gap: 4 }}>
            <T variant="meta" tone="muted" style={{ marginBottom: 4 }}>
              The disk grows on the next boot, so picking a size reboots the machine. The workspace,
              checkouts and the agent&apos;s session are kept — and a disk can only ever grow, never
              shrink back.
            </T>
            {growTiers.map((t) => (
              <ActionRow
                key={t}
                icon="hard-drive"
                label={t}
                hint={t === diskTier ? "current" : "restart with this size"}
                disabled={busy || t === diskTier}
                onPress={() => act(() => api.setDisk(box.name, t), onClose)}
              />
            ))}
            <Button title="Cancel" variant="secondary" onPress={() => setPane("menu")} disabled={busy} />
          </View>
        )}

        {pane === "rename" && (
          <View style={{ gap: 10 }}>
            <Field placeholder={box.title || "Name this run…"} value={title} onChangeText={setTitle} autoFocus />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setPane("menu")} />
              <Button
                title="Rename"
                style={{ flex: 1 }}
                loading={busy}
                disabled={!title.trim()}
                onPress={() => act(() => api.rename(box.name, title.trim()), () => onClose())}
              />
            </View>
          </View>
        )}

        {pane === "attach" && (
          <View style={{ gap: 8 }}>
            <Field placeholder="Search repos…" value={repoQuery} onChangeText={setRepoQuery} autoCapitalize="none" mono autoFocus />
            {repoHits.map((r) => (
              <Pressable
                key={r.fullName}
                onPress={() =>
                  act(
                    () => api.attachRepo(box.name, r.fullName),
                    () => {
                      setNote(`Attached ${r.fullName}.`);
                      setPane("menu");
                      setRepoQuery("");
                    },
                  )
                }
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 10,
                  paddingHorizontal: 4,
                  borderRadius: radius.lg,
                  backgroundColor: pressed ? palette.accent : "transparent",
                })}
              >
                <Icon name="git-branch" size={13} color={palette.mutedForeground} />
                <T variant="meta" mono style={{ flex: 1 }} numberOfLines={1}>
                  {r.fullName}
                </T>
                {r.private && <Icon name="lock" size={12} color={palette.faint} />}
              </Pressable>
            ))}
          </View>
        )}

        {pane === "destroy" && (
          <View style={{ gap: 12 }}>
            <T variant="body" tone="muted">
              Stops the microVM and discards its workspace — files, checkouts and uncommitted work. The
              conversation is not recoverable afterwards.
            </T>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setPane("menu")} />
              <Button
                title={busy ? "Destroying…" : "Destroy"}
                variant="destructive"
                style={{ flex: 1 }}
                loading={busy}
                onPress={() =>
                  act(() => api.teardown(box.name), () => {
                    onClose();
                    onDestroyed?.();
                  })
                }
              />
            </View>
          </View>
        )}
      </View>
    </Sheet>
  );
}
