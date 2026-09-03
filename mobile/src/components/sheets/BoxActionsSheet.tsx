import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { api, type BoxView, type RepoInfo } from "@/lib/api";
import { parseTrace } from "@/lib/trace";
import { toMarkdown } from "@/lib/transcript-tools";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "../ui/AppText";
import { ArmButton } from "../ui/ArmButton";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

/** Machine controls at web ⋯-menu parity: rename, keep, attach repo, copy
 * transcript, run again, sleep/wake, and Destroy behind arm-to-confirm. */
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
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const [repoHits, setRepoHits] = useState<RepoInfo[]>([]);

  useEffect(() => {
    if (!attaching) return;
    const t = setTimeout(() => {
      api.repos(repoQuery).then((r) => setRepoHits(r.repos.slice(0, 6))).catch(() => setRepoHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [attaching, repoQuery]);

  if (!box) return null;
  const sleeping = box.boxStatus === "Stopped";

  const act = async (fn: () => Promise<unknown>, done?: () => void) => {
    setNote(null);
    try {
      await fn();
      onChanged();
      done?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={box.title || box.name}>
      <View style={{ gap: 10, paddingBottom: 12 }}>
        {note ? <T variant="meta" tone="destructive">{note}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Field placeholder="Rename this run…" value={title} onChangeText={setTitle} style={{ flex: 1 }} />
          <Button
            title="Rename"
            small
            variant="secondary"
            onPress={() => title.trim() && act(() => api.rename(box.name, title.trim()), () => setTitle(""))}
          />
        </View>

        {attaching ? (
          <View style={{ gap: 6 }}>
            <Field placeholder="Search repos to attach…" value={repoQuery} onChangeText={setRepoQuery} autoCapitalize="none" mono autoFocus />
            {repoHits.map((r) => (
              <Pressable
                key={r.fullName}
                onPress={() =>
                  act(
                    () => api.attachRepo(box.name, r.fullName),
                    () => {
                      setAttaching(false);
                      setRepoQuery("");
                      setNote(`Attached ${r.fullName} — checked out under /workspace; the agent is told at its next turn.`);
                    },
                  )
                }
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 8,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Icon name="git-branch" size={13} color={palette.mutedForeground} />
                <T variant="meta" mono style={{ flex: 1 }} numberOfLines={1}>
                  {r.fullName}
                </T>
                {r.private && <Icon name="lock" size={12} color={palette.faint} />}
              </Pressable>
            ))}
            <Button title="Cancel" small variant="ghost" onPress={() => setAttaching(false)} />
          </View>
        ) : (
          <Button
            title="Attach a repository"
            variant="secondary"
            disabled={sleeping}
            onPress={() => setAttaching(true)}
          />
        )}

        {log ? (
          <Button
            title="Copy transcript (Markdown)"
            variant="secondary"
            onPress={async () => {
              await Clipboard.setStringAsync(
                toMarkdown(parseTrace(log), { title: box.title || box.task?.split("\n")[0] || box.name, machine: box.name }),
              );
              setNote("Transcript copied as Markdown.");
            }}
          />
        ) : null}

        {onRunAgain && box.task ? (
          <Button title="Run again — new machine, same brief" variant="secondary" onPress={onRunAgain} />
        ) : null}

        <Button
          title={box.kept ? "Release (sleeps · auto-destroyed)" : "Keep — never reap while asleep"}
          variant="secondary"
          onPress={() => act(() => api.keep(box.name, !box.kept))}
        />
        <Button
          title={sleeping ? "Wake" : "Sleep now — a reply wakes it"}
          variant="secondary"
          disabled={!sleeping && box.runState === "running"}
          onPress={() => act(() => (sleeping ? api.wake(box.name) : api.sleep(box.name)))}
        />
        <ArmButton
          title="Destroy machine"
          armedTitle="Tap again — discards workspace and transcript"
          onConfirm={() =>
            act(() => api.teardown(box.name), () => {
              onClose();
              onDestroyed?.();
            })
          }
        />
      </View>
    </Sheet>
  );
}
