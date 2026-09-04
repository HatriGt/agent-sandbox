import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { api, type BoxView, type RepoInfo } from "@/lib/api";
import { parseTrace } from "@/lib/trace";
import { toMarkdown } from "@/lib/transcript-tools";
import { serverUrl } from "@/lib/config";
import { isSleeping } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Icon, type IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

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
      <View style={{ flex: 1 }}>
        <T variant="body" weight="medium" style={{ color }}>
          {label}
        </T>
        {hint ? (
          <T variant="micro" tone="faint">
            {hint}
          </T>
        ) : null}
      </View>
      <Icon name="chevron-right" size={15} color={palette.faint} />
    </Pressable>
  );
}

type Pane = "menu" | "rename" | "attach" | "destroy";

/** Machine controls, mirroring the web thread's ⋯ menu. */
export function BoxActionsSheet({
  box,
  log,
  visible,
  onClose,
  onChanged,
  onDestroyed,
  onRunAgain,
}: {
  box: BoxView | null;
  log?: string;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDestroyed?: () => void;
  onRunAgain?: () => void;
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
    pane === "rename" ? "Rename" : pane === "attach" ? "Attach a repository" : pane === "destroy" ? "Destroy machine?" : box.title || box.name;

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
              onPress={() => act(() => (sleeping ? api.wake(box.name) : api.sleep(box.name)), onClose)}
            />
            <View style={{ height: 1, backgroundColor: palette.border, marginVertical: 6 }} />
            <ActionRow icon="trash-2" label="Destroy machine…" destructive onPress={() => setPane("destroy")} />
          </>
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
