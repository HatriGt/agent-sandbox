import * as React from "react";
import { readDraft, writeDraft } from "@/lib/draft";
import { ArrowUp, AtSign, Check as CheckIcon, Clock, ImagePlus, Loader2, MessageCircleQuestion, Terminal, X } from "lucide-react";
import { motion } from "motion/react";
import { ATTACHMENTS_DIR } from "@/lib/session-context";
import { Lightbox } from "@/components/ui/lightbox";
import { FileMark } from "@/lib/fileIcon";
import { toast } from "sonner";
import { api, type RunState } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MentionMenu, expandMentions, mentionAt, type MentionState } from "./MentionMenu";
import { ModelChip, useModelChoice } from "./ModelPicker";
import { SkillChip, SkillMenu } from "./SkillMenu";
import { slashAt, stripSlashToken, typedSkillToken, type SlashState } from "@/lib/slash";
import { useCached } from "@/lib/cache";
import type { SkillView } from "@/lib/api";
import { cn } from "@/lib/utils";

type Mode = "agent" | "side";

/**
 * The composer.
 *
 * One input, one primary destination: the AGENT doing the work. Sending to it is always allowed —
 * if the agent is mid-turn the controller queues the message and delivers it the moment the current
 * turn ends, and the thread shows it as "queued" until then. Answering a paused question goes through
 * the question card, so the composer never has to explain "this releases the run".
 *
 * The secondary destination is a SIDE QUESTION: a separate read-only helper inside the same sandbox
 * answers questions ABOUT the run (what changed, why is it stuck) without interrupting the agent. It
 * used to be called "Co-pilot", which suggested it steered; it does not. The label and copy now say
 * exactly what it is. A sleeping (stopped) sandbox has nothing to inspect, so side questions are off
 * there; a reply wakes it.
 *
 * `@` opens the workspace file picker (Cursor-style); mentions are expanded into explicit paths so
 * the agent reads the right files.
 */
export function SendBar({
  boxName,
  runState,
  sleeping = false,
  repos = [],
  onAsk,
  onReplied,
  onQueued,
  onFocusRequest,
  onReplyFailed,
}: {
  boxName: string;
  runState: RunState;
  sleeping?: boolean;
  repos?: { name: string; branch?: string }[];
  onAsk: (question: string) => void;
  onReplied: (text: string) => void;
  onQueued?: () => void;
  onFocusRequest?: (focus: () => void) => void;
  /** The server could not deliver this reply: the parent drops the optimistic echo. */
  onReplyFailed?: (text: string) => void;
}) {
  const busy = runState === "running" && !sleeping;
  const canSide = !sleeping;
  const [mode, setMode] = React.useState<Mode>("agent");
  const [value, setValue] = React.useState(() => readDraft(boxName));
  React.useEffect(() => setValue(readDraft(boxName)), [boxName]);
  const model = useModelChoice(boxName);
  React.useEffect(() => writeDraft(boxName, value), [boxName, value]);
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mention, setMention] = React.useState<MentionState | null>(null);
  // `/skill` menu: open while the message starts with `/` and something matches an enabled skill.
  const [slash, setSlash] = React.useState<SlashState | null>(null);
  const [slashMatches, setSlashMatches] = React.useState(0);
  // The chosen skill rides as a chip above the text (like file mentions), not as raw `/name` prose.
  const skillsCache = useCached("skills", (signal) => api.skills(signal));
  const [skill, setSkill] = React.useState<SkillView | null>(null);
  React.useEffect(() => setSkill(null), [boxName]);
  const findSkill = (name: string) => (skillsCache.data?.skills ?? []).find((s) => s.enabled && s.name === name) ?? null;
  // Images pasted, dropped or picked: kept as data URLs for the preview, uploaded into the sandbox on
  // send (/workspace/.attachments) and referenced in the message so the agent opens them with Read.
  const [images, setImages] = React.useState<{ id: string; name: string; dataUrl: string; size: number }[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [preview, setPreview] = React.useState<{ name: string; dataUrl: string } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const addImages = React.useCallback((list: Iterable<File>) => {
    for (const f of list) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`${f.name || "image"} is over 8 MB`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const stem = (f.name || "pasted").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 40) || "image";
        setImages((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: `${stem}.${ext}`, dataUrl: String(reader.result), size: f.size }]);
      };
      reader.readAsDataURL(f);
    }
  }, []);
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      addImages(files);
    }
  };
  // Files the message refers to — shown as removable chips above the text (Cursor's context pills),
  // not as `@path` tokens buried in prose. They travel with the message as explicit references.
  const [files, setFiles] = React.useState<string[]>([]);
  React.useEffect(() => setFiles([]), [boxName]);

  const textarea = () => document.getElementById("send-input") as HTMLTextAreaElement | null;
  React.useEffect(() => {
    onFocusRequest?.(() => textarea()?.focus());
  }, [onFocusRequest]);
  React.useEffect(() => {
    if (!canSide && mode === "side") setMode("agent");
  }, [canSide, mode]);

  const effective: Mode = canSide ? mode : "agent";
  const toAgent = effective === "agent";

  const updateMention = (next: string) => {
    const el = textarea();
    const caret = el?.selectionStart ?? next.length;
    setMention(mentionAt(next, caret));
    setSlash(skill ? null : slashAt(next, caret));
    // Typing a full `/name ` by hand — at the start or mid-message — converts to the chip the
    // moment the space lands, same as picking from the menu.
    if (!skill) {
      const t = typedSkillToken(next);
      const hit = t ? findSkill(t.name) : null;
      if (hit && t) {
        setSkill(hit);
        setValue(next.slice(0, t.start) + next.slice(t.start + t.length));
        setSlash(null);
      }
    }
  };

  const pickSkill = (name: string) => {
    // The `/query` token — wherever it sits — becomes a chip; the rest stays as the message.
    const hit = findSkill(name);
    const at = slash?.start ?? 0;
    const stripped = stripSlashToken(value, at);
    if (hit) {
      setSkill(hit);
      setValue(stripped.value);
    } else {
      setValue(value.slice(0, at) + `/${name} ` + stripped.value.slice(stripped.caret));
    }
    setSlash(null);
    requestAnimationFrame(() => {
      const t = textarea();
      if (!t) return;
      t.focus();
      t.setSelectionRange(stripped.caret, stripped.caret);
    });
  };

  const pickFile = (path: string) => {
    if (!mention) return;
    const el = textarea();
    const caret = el?.selectionStart ?? value.length;
    // Remove the `@query` token the user typed; the file becomes a chip.
    const before = value.slice(0, mention.start);
    const after = value.slice(caret).replace(/^\s/, "");
    const next = `${before}${after}`;
    setValue(next);
    setFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setMention(null);
    requestAnimationFrame(() => {
      const t = textarea();
      if (!t) return;
      t.focus();
      t.setSelectionRange(before.length, before.length);
    });
  };

  const send = async () => {
    const text = value.trim();
    if ((!text && !files.length && !images.length && !skill) || sending) return;
    setSending(true);
    setError(null);
    const attached = files;
    const attachedImages = images;
    const chosenSkill = skill;
    let message = expandMentions(files.length ? `${text}\n\nFiles: ${files.map((f) => `@${f}`).join(" ")}` : text);
    // The skill rides as the leading /token — the agent is instructed to invoke it for the message.
    if (chosenSkill) message = `/${chosenSkill.name}${message ? ` ${message}` : ""}`;
    try {
      // Upload images first so the message can name their in-box paths.
      if (attachedImages.length) {
        const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
        const paths: string[] = [];
        for (const [i, img] of attachedImages.entries()) {
          const rel = `${ATTACHMENTS_DIR}/${stamp}-${i + 1}-${img.name}`;
          await api.writeFile(boxName, rel, img.dataUrl, "base64");
          paths.push(`/workspace/${rel}`);
        }
        message = `${message}${message ? "\n\n" : ""}Attached ${paths.length === 1 ? "image" : "images"} (open with the Read tool):\n${paths.map((p) => `- ${p}`).join("\n")}`;
      }
      if (!toAgent) {
        setValue("");
        setFiles([]);
        setImages([]);
        setSkill(null);
        onAsk(message);
      } else {
        setValue("");
        setFiles([]);
        setImages([]);
        setSkill(null);
        // Echo NOW. The controller wakes/kicks the run in a few seconds; a message that only appears
        // when the server answers reads as a broken chat. The echo is withdrawn if delivery fails,
        // and the durable ⟦you⟧ line in the log replaces it once it lands.
        const echo =
          (chosenSkill ? `/${chosenSkill.name} ` : "") +
          (attached.length ? `${text}\n${attached.map((f) => `@${f}`).join(" ")}` : text) +
          (message.includes("Attached image") ? message.slice(message.indexOf("Attached image") - 2) : "");
        if (!busy) onReplied(echo);
        try {
          // The picked model rides the send once; the server makes it sticky for the box.
          const res = await api.resume(boxName, message, model.picked ? { model: model.picked } : {});
          if ("queued" in res && res.queued) {
            if (!busy) onReplyFailed?.(echo);
            onQueued?.();
            toast("Queued for the agent", {
              description: "It is mid-turn. Your message is delivered the moment this turn finishes.",
              icon: <Clock className="size-4" />,
            });
          }
        } catch (e) {
          if (!busy) onReplyFailed?.(echo);
          throw e;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setValue(text);
      setFiles(attached);
      setImages(attachedImages);
      setSkill(chosenSkill);
      toast.error("Could not send", { description: msg });
      setSending(false);
      return;
    }
    // Spinner → check morph: the send is confirmed where the eye already is, then the arrow returns.
    setSending(false);
    setSent(true);
    window.setTimeout(() => setSent(false), 900);
  };

  const hint = error
    ? null
    : sleeping
      ? "Waking the sandbox. Type ahead — it is sent the moment the machine is back."
      : toAgent
        ? busy
          ? "The agent is mid-turn. Your message is queued and delivered when this turn finishes."
          : "Enter to send · Shift+Enter for a new line · paste or drop images"
        : "Answered by a separate read-only helper inside the sandbox. The agent is not interrupted.";

  return (
    <div className="pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* Same column as the conversation and the changes dock: max-w-3xl with the same inner gutter. */}
      <div className="relative mx-auto min-w-0 max-w-3xl px-3 md:px-6">
        {mention && <MentionMenu session={boxName} repos={repos} state={mention} onPick={pickFile} onClose={() => setMention(null)} />}
        {!mention && slash && <SkillMenu state={slash} onPick={pickSkill} onClose={() => setSlash(null)} onMatches={setSlashMatches} />}
        <PromptInput
          value={value}
          onValueChange={(v) => {
            setValue(v);
            updateMention(v);
          }}
          onSubmit={() => {
            if (mention) return; // Enter inside the mention menu picks a file
            if (slash && slashMatches > 0) return; // Enter inside the skill menu picks a skill
            void send();
          }}
          isLoading={sending}
          className={cn(
            "bg-card raised rounded-xl p-2 transition-[border-color,box-shadow] duration-300",
            toAgent ? "border-line-strong" : "border-border border-dashed",
            sleeping && "border-sleep/50",
            dragOver && "border-live ring-live/40 ring-2"
          )}
          onPaste={onPaste}
          onDragOver={(e) => {
            if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addImages(e.dataTransfer.files);
          }}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pt-1.5" onClick={(e) => e.stopPropagation()}>
              {images.map((img) => (
                <span key={img.id} className="enter group relative block size-16 overflow-hidden rounded-md border" title={img.name}>
                  <button type="button" onClick={() => setPreview(img)} aria-label={`Preview ${img.name}`} className="block size-full cursor-zoom-in">
                    <img src={img.dataUrl} alt={img.name} className="size-full object-cover transition-transform duration-200 group-hover:scale-105" />
                  </button>
                  <span className="stamp absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-px text-[9px] text-white">{img.name}</span>
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                    aria-label={`Remove ${img.name}`}
                    className="bg-card/80 text-foreground hover:bg-card absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full opacity-0 shadow-e1 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {skill && (
            <div className="flex flex-wrap gap-1.5 px-2 pt-1.5" onClick={(e) => e.stopPropagation()}>
              <SkillChip skill={skill} onRemove={() => setSkill(null)} />
            </div>
          )}
          <label htmlFor="send-input" className="sr-only">
            {toAgent ? "Message the agent" : "Ask a side question about this run"}
          </label>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2 pt-1.5" onClick={(e) => e.stopPropagation()}>
              {files.map((f) => {
                const base = f.slice(f.lastIndexOf("/") + 1);
                const dir = f.slice(0, Math.max(0, f.lastIndexOf("/")));
                return (
                  <span key={f} className="bg-muted text-foreground enter inline-flex h-7 max-w-full items-center gap-1.5 rounded-md pl-2 pr-1 text-micro" title={f}>
                    <FileMark path={f} />
                    <span className="font-mono font-medium">{base}</span>
                    {dir && <span className="text-muted-foreground hidden truncate font-mono sm:inline">{dir}</span>}
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                      aria-label={`Remove ${base}`}
                      className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <PromptInputTextarea
            id="send-input"
            className="px-2.5 pt-2 text-body"
            onKeyDown={(e) => {
              const nav = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key);
              if (!nav) return;
              if (mention) {
                e.preventDefault();
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent("asb:mention-nav", { detail: e.key }));
              } else if (slash && slashMatches > 0) {
                e.preventDefault();
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent("asb:skill-nav", { detail: e.key }));
              }
            }}
            onKeyUp={() => updateMention(value)}
            onClick={() => updateMention(value)}
            placeholder={
              skill
                ? `Add details for /${skill.name} — or just send…`
                : sleeping
                  ? "Type ahead — sends once the sandbox is awake…"
                  : toAgent
                    ? busy
                      ? "Queue a follow-up for when this turn finishes…"
                      : "Send a follow-up instruction… ( / for skills · @ for files )"
                    : "Ask about this run — what changed, what is it doing, why is it stuck…"
            }
          />
          <PromptInputActions className="justify-between gap-2 pt-1">
            <div className="flex items-center gap-1">
              <div
                role="radiogroup"
                aria-label="Send to"
                className="bg-muted inline-flex items-center gap-0.5 rounded-md p-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <ModeChip
                  active={toAgent}
                  onClick={() => setMode("agent")}
                  icon={busy ? <Clock className="size-3.5" /> : <Terminal className="size-3.5" />}
                  label={busy ? "Queue for agent" : "Agent"}
                />
                <ModeChip
                  active={!toAgent}
                  disabled={!canSide}
                  onClick={() => setMode("side")}
                  icon={<MessageCircleQuestion className="size-3.5" />}
                  label="Side question"
                  disabledReason="A sleeping sandbox has nothing to inspect — wake it with a message first"
                />
              </div>
              {/* Model switch: only for the AGENT lane — the side co-pilot stays on ASK_MODEL. */}
              {toAgent && <ModelChip current={model.current} models={model.models} defaultId={model.defaultId} onPick={model.pick} disabled={sending} />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const t = textarea();
                      if (!t) return;
                      const caret = t.selectionStart ?? value.length;
                      const needsSpace = caret > 0 && !/\s/.test(value[caret - 1] ?? "");
                      const insert = `${needsSpace ? " " : ""}@`;
                      const next = value.slice(0, caret) + insert + value.slice(caret);
                      setValue(next);
                      requestAnimationFrame(() => {
                        t.focus();
                        const pos = caret + insert.length;
                        t.setSelectionRange(pos, pos);
                        setMention(mentionAt(next, pos));
                      });
                    }}
                    aria-label="Mention a file"
                    className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md transition-colors"
                  >
                    <AtSign className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Mention a workspace file</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInput.current?.click();
                    }}
                    aria-label="Attach an image"
                    className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md transition-colors"
                  >
                    <ImagePlus className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Attach an image — or paste / drop one</TooltipContent>
              </Tooltip>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addImages(e.target.files ?? []);
                  e.target.value = "";
                }}
              />
            </div>

            <p
              className={cn("hidden min-w-0 flex-1 truncate text-micro sm:block", error ? "text-destructive" : "text-muted-foreground")}
              role={error ? "alert" : undefined}
            >
              {error ?? hint}
            </p>

            <Button
              variant={toAgent ? "primary" : "outline"}
              size="icon"
              onClick={send}
              disabled={sending || (!value.trim() && !files.length && !images.length && !skill)}
              aria-label={toAgent ? (busy ? "Queue for the agent" : "Send to the agent") : "Ask a side question"}
              className="rounded-full transition-[opacity,transform,background-color] duration-200 disabled:opacity-35 enabled:hover:scale-105"
            >
              {sending ? (
                <Loader2 className="animate-spin" />
              ) : sent ? (
                <motion.span key="sent" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 480, damping: 22 }} className="grid place-items-center">
                  <CheckIcon />
                </motion.span>
              ) : busy && toAgent ? (
                <Clock />
              ) : (
                <ArrowUp />
              )}
            </Button>
          </PromptInputActions>
        </PromptInput>
        <Lightbox src={preview?.dataUrl ?? null} name={preview?.name ?? ""} open={!!preview} onClose={() => setPreview(null)} />

        <p className={cn("mt-1.5 min-h-4 px-1 text-center text-micro sm:hidden", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      </div>
    </div>
  );
}

function ModeChip({
  active,
  disabled,
  onClick,
  icon,
  label,
  disabledReason,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabledReason?: string;
}) {
  const chip = (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-medium transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-card text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
  if (!disabled || !disabledReason) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {chip}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
