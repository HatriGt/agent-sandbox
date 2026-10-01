import * as React from "react";
import { readDraft, writeDraft } from "@/lib/draft";
import { ArrowUp, AtSign, Check as CheckIcon, Clock, ImagePlus, Loader2, MessageCircleQuestion, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ATTACHMENTS_DIR } from "@/lib/session-context";
import { Lightbox } from "@/components/ui/lightbox";
import { FileMark } from "@/lib/fileIcon";
import { toast } from "sonner";
import { api, type RunState } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MentionMenu, expandMentions, mentionAt, type MentionState } from "./MentionMenu";
import { useModelChoice } from "./ModelPicker";
import { ComposerToolbar, ModelMenu, PlusMenu, SkillsMenu, ToolButton, useComposerMenus } from "@/components/composer/Toolbar";
import { SkillChip, SkillMenu } from "./SkillMenu";
import { slashAt, stripSlashToken, typedSkillToken, type SlashState } from "@/lib/slash";
import { useCached } from "@/lib/cache";
import type { SkillView } from "@/lib/api";
import { smartJoin, useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton, VoicePill } from "@/components/ui/voice-button";
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
  seed,
  onReplyFailed,
  phase,
}: {
  /** What the thread is in the middle of, for the composer's copy: a run being set up, a question
   *  waiting on the card above, or a box that has never run anything. */
  phase?: "starting" | "asked" | "fresh";
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
  /** Text to drop into the composer (e.g. a starter prompt); `n` changes to re-apply the same text. */
  seed?: { text: string; n: number } | null;
}) {
  const busy = runState === "running" && !sleeping;
  const canSide = !sleeping;
  const [mode, setMode] = React.useState<Mode>("agent");
  const [value, setValue] = React.useState(() => readDraft(boxName));
  React.useEffect(() => setValue(readDraft(boxName)), [boxName]);
  const model = useModelChoice(boxName);
  const menus = useComposerMenus("model");
  const modelOptions = {
    current: model.current,
    models: model.models,
    defaultId: model.defaultId,
    onPick: model.pick,
    offDefault: !!model.current && model.current.id !== model.defaultId,
    onReset: () => {
      const d = model.models.find((m) => m.id === model.defaultId);
      if (d) model.pick(d);
    },
  };
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
  // Readers still decoding a just-pasted image: a send racing them would silently drop the image.
  const readersInFlight = React.useRef(0);
  const addImages = React.useCallback((list: Iterable<File>) => {
    for (const f of list) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`${f.name || "image"} is over 8 MB`);
        continue;
      }
      const reader = new FileReader();
      readersInFlight.current++;
      reader.onerror = () => {
        readersInFlight.current--;
      };
      reader.onload = () => {
        readersInFlight.current--;
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

  // Dictation: finalized phrases land at the caret through the same setValue path typing uses,
  // so drafts, @-mentions and /-skills keep working. Nothing auto-sends.
  const voice = useVoiceInput({
    onFinal: (spoken) => {
      setValue((prev) => {
        const el = textarea();
        const caret = el && document.activeElement === el ? (el.selectionStart ?? prev.length) : prev.length;
        const glue = smartJoin(prev.slice(0, caret), spoken);
        const next = prev.slice(0, caret) + glue + prev.slice(caret);
        requestAnimationFrame(() => {
          const t = textarea();
          if (!t) return;
          const pos = caret + glue.length;
          t.setSelectionRange(pos, pos);
        });
        return next;
      });
    },
  });
  React.useEffect(() => {
    onFocusRequest?.(() => textarea()?.focus());
  }, [onFocusRequest]);
  React.useEffect(() => {
    if (!seed) return;
    setValue(seed.text);
    requestAnimationFrame(() => {
      const t = textarea();
      t?.focus();
      t?.setSelectionRange(seed.text.length, seed.text.length);
    });
  }, [seed]);
  React.useEffect(() => {
    if (!canSide && mode === "side") setMode("agent");
  }, [canSide, mode]);

  const effective: Mode = canSide ? mode : "agent";
  const toAgent = effective === "agent";
  const still = useReducedMotion();
  // One slot, four faces: the icon morphs between them rather than swapping.
  const sendIcon = sending ? "sending" : sent ? "sent" : busy && toAgent ? "queue" : "send";

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
    if (readersInFlight.current > 0) {
      // A pasted image is still decoding; sending now would drop it. Retry (via the ref, so the
      // retry sees the state that includes the decoded image) once the reader lands.
      setTimeout(() => sendRef.current(), 60);
      return;
    }
    voice.stop();
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
      let imagesTail = "";
      if (attachedImages.length) {
        const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
        const paths: string[] = [];
        for (const [i, img] of attachedImages.entries()) {
          const rel = `${ATTACHMENTS_DIR}/${stamp}-${i + 1}-${img.name}`;
          await api.writeFile(boxName, rel, img.dataUrl, "base64");
          paths.push(`/workspace/${rel}`);
        }
        imagesTail = `Attached ${paths.length === 1 ? "image" : "images"} (open with the Read tool):\n${paths.map((p) => `- ${p}`).join("\n")}`;
        message = `${message}${message ? "\n\n" : ""}${imagesTail}`;
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
        const body = attached.length ? `${text}\n${attached.map((f) => `@${f}`).join(" ")}` : text;
        const echo =
          (chosenSkill ? `/${chosenSkill.name} ` : "") +
          body +
          // Image-only sends have no body: the old indexOf-based slice went negative there and
          // produced an empty echo (a permanent ghost bubble).
          (imagesTail ? `${body ? "\n\n" : ""}${imagesTail}` : "");
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
  const sendRef = React.useRef(send);
  sendRef.current = send;

  const hint = error
    ? null
    : sleeping
      ? "Waking the sandbox — type ahead, it sends when the machine is back."
      : toAgent
        ? busy
          ? "Agent is mid-turn — your message is queued until this turn ends."
          : phase === "starting"
            ? "Starting up — type ahead, it is delivered once the agent is listening."
            : phase === "asked"
              ? "Pick an option above, or answer here — it reaches the agent as your answer."
              : "Enter to send · Shift+Enter for a new line · paste or drop images"
        : "Answered by a read-only helper in the sandbox — the agent is not interrupted.";

  return (
    <div className="pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* Same column as the conversation and the changes dock: max-w-3xl with the same inner gutter. */}
      <div className="relative mx-auto min-w-0 max-w-3xl px-3 md:px-6">
        <VoicePill state={voice.state} interim={voice.interim} />
        <AnimatePresence>
          {mention && <MentionMenu key="mention" session={boxName} repos={repos} state={mention} onPick={pickFile} onClose={() => setMention(null)} />}
          {!mention && slash && <SkillMenu key="skill" state={slash} onPick={pickSkill} onClose={() => setSlash(null)} onMatches={setSlashMatches} />}
        </AnimatePresence>
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
            "bg-card raised composer-glow composer-depth rounded-2xl p-2",
            toAgent ? "border-line-strong" : "border-border border-dashed",
            sleeping && "border-sleep/50",
            dragOver && "border-live ring-live/40 ring-2",
            (voice.state === "listening" || voice.state === "arming") && "mic-glow"
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
          {/* Chip rows stay mounted through their own exit: the last chip used to vanish with the row. */}
          <AnimatePresence initial={false}>
          {images.length > 0 && (
            <ChipRow key="images" still={still} className="flex flex-wrap gap-2 px-2 pt-1.5">
              <AnimatePresence initial={false} mode="popLayout">
              {images.map((img) => (
                <motion.span key={img.id} {...chipMotion(still)} className="group relative block size-16 overflow-hidden rounded-md border" title={img.name}>
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
                </motion.span>
              ))}
              </AnimatePresence>
            </ChipRow>
          )}
          </AnimatePresence>
          <label htmlFor="send-input" className="sr-only">
            {toAgent ? "Message the agent" : "Ask a side question about this run"}
          </label>
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
                      : phase === "fresh"
                        ? "Describe a task for this machine… ( / skills · @ files )"
                        : phase === "starting"
                          ? "Type ahead — delivered once the agent is listening…"
                          : phase === "asked"
                            ? "Answer in your own words…"
                            : "Send a follow-up… ( / skills · @ files )"
                    : "Ask about this run — what changed, what is it doing, why is it stuck…"
            }
          />
          {/* Context chips inside the box, above the toolbar: the skill, then @-mentioned files. */}
          <AnimatePresence initial={false}>
          {(skill || files.length > 0) && (
            <ChipRow key="context" still={still} className="flex flex-wrap gap-1.5 px-2 pt-1.5">
              {skill && <SkillChip skill={skill} onRemove={() => setSkill(null)} />}
              <AnimatePresence initial={false} mode="popLayout">
              {files.map((f) => {
                const base = f.slice(f.lastIndexOf("/") + 1);
                const dir = f.slice(0, Math.max(0, f.lastIndexOf("/")));
                return (
                  <motion.span key={f} {...chipMotion(still)} className="bg-muted text-foreground inline-flex h-7 max-w-full items-center gap-1.5 rounded-md pl-2 pr-1 text-micro" title={f}>
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
                  </motion.span>
                );
              })}
              </AnimatePresence>
            </ChipRow>
          )}
          </AnimatePresence>
          {/* One row, never two: everything is nowrap and the tool cluster can shrink (min-w-0) so the
              send button always keeps its place at the right edge — on a phone as much as beside an
              open workspace pane. */}
          {/* The shared toolbar (components/composer/Toolbar.tsx): + / @ · Side question · Model … voice
              send. One row, never two — labels drop below `sm`, send keeps its place at the right. */}
          <PromptInputActions className="block pt-0">
            <ComposerToolbar
              left={
                <>
                  <PlusMenu
                    {...menus.props("plus")}
                    items={[{ key: "image", icon: <ImagePlus />, label: "Attach an image — or paste / drop one", run: () => fileInput.current?.click() }]}
                  />
                  <SkillsMenu
                    {...menus.props("skills")}
                    current={skill?.name ?? null}
                    onPick={(name) => {
                      const hit = findSkill(name);
                      if (hit) setSkill(hit);
                      requestAnimationFrame(() => textarea()?.focus());
                    }}
                  />
                  <ToolButton
                    icon={<AtSign />}
                    aria-label="Mention a workspace file"
                    title="Mention a workspace file ( @ )"
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
                  />
                  {/* The one secondary destination, as a single toggle: off = the agent (always), on =
                      the read-only side helper. The dashed border and the caption say which is live. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex" tabIndex={!canSide ? 0 : -1}>
                        <ToolButton
                          icon={<MessageCircleQuestion />}
                          label="Side question"
                          aria-pressed={!toAgent}
                          active={!toAgent}
                          disabled={!canSide}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMode(toAgent ? "side" : "agent");
                          }}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {!canSide ? "A sleeping sandbox has nothing to inspect — wake it with a message first" : toAgent ? "Ask about this run without interrupting the agent" : "Back to messaging the agent"}
                    </TooltipContent>
                  </Tooltip>
                  {/* Model: only for the AGENT lane — the side helper stays on ASK_MODEL. */}
                  {toAgent && <ModelMenu {...menus.props("model")} model={modelOptions} disabled={sending} />}
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
                </>
              }
              right={
                <>
                  {voice.supported && <VoiceButton state={voice.state} level={voice.level} onToggle={voice.toggle} />}
            <Button
              variant={toAgent ? "primary" : "outline"}
              size="icon"
              onClick={send}
              disabled={sending || (!value.trim() && !files.length && !images.length && !skill)}
              aria-label={toAgent ? (busy ? "Queue for the agent" : "Send to the agent") : "Ask a side question"}
              className="shrink-0 rounded-full transition-[opacity,scale,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out-quint)] disabled:opacity-35 enabled:hover:scale-105 enabled:active:scale-90 motion-reduce:enabled:hover:scale-100 motion-reduce:enabled:active:scale-100"
            >
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={sendIcon}
                  initial={still ? { opacity: 0 } : { scale: 0.4, opacity: 0, rotate: sendIcon === "queue" ? -90 : 0 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={still ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
                  transition={still ? { duration: 0.12 } : { type: "spring", stiffness: 520, damping: 28, mass: 0.6 }}
                  className="grid place-items-center"
                >
                  {sendIcon === "sending" ? <Loader2 className="animate-spin" /> : sendIcon === "sent" ? <CheckIcon /> : sendIcon === "queue" ? <Clock /> : <ArrowUp />}
                </motion.span>
              </AnimatePresence>
            </Button>
                </>
              }
            />
          </PromptInputActions>
        </PromptInput>
        <Lightbox src={preview?.dataUrl ?? null} name={preview?.name ?? ""} open={!!preview} onClose={() => setPreview(null)} />

        {/* The hint is a caption under the composer, never squeezed into the action row where it
            truncated mid-sentence. Errors take the same slot in the destructive tone. */}
        <p className={cn("mt-1.5 min-h-4 px-2 text-center text-micro line-clamp-2 sm:line-clamp-none sm:truncate sm:text-left", error ? "text-destructive" : "text-faint")} role={error ? "alert" : undefined} title={error ?? hint ?? undefined}>
          {error ?? hint}
        </p>
      </div>
    </div>
  );
}

/** Attachment chips pop in from their own centre and shrink out; reduced motion keeps only the fade. */
function chipMotion(still: boolean | null) {
  return {
    layout: !still,
    initial: still ? { opacity: 0 } : { opacity: 0, scale: 0.85 },
    animate: { opacity: 1, scale: 1 },
    exit: still ? { opacity: 0 } : { opacity: 0, scale: 0.85 },
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
  };
}

/**
 * A row of chips that folds open when the first chip lands and closes when the last one goes. The
 * row animates its own height/opacity, so the presence wrapper keeps it (and its last chip) around
 * for the exit instead of unmounting the row the instant it empties.
 */
function ChipRow({ still, className, children }: { still: boolean | null; className: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
      animate={still ? { opacity: 1 } : { height: "auto", opacity: 1 }}
      exit={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={className}>{children}</div>
    </motion.div>
  );
}
