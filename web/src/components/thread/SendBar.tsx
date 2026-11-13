import * as React from "react";
import { pushSent, readDraft, readSent, writeDraft } from "@/lib/draft";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ArrowUp, AtSign, Check as CheckIcon, Clock, ImagePlus, Loader2, MessageCircleQuestion, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { ATTACHMENTS_DIR } from "@/lib/session-context";
import { Lightbox } from "@/components/ui/lightbox";
import { toast } from "sonner";
import { api, type RunState } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MentionMenu, expandMentions, mentionAt, type MentionState } from "./MentionMenu";
import { useModelChoice } from "./ModelPicker";
import { ComposerToolbar, ModelMenu, PlusMenu, SkillsMenu, ToolButton, useComposerMenus } from "@/components/composer/Toolbar";
import { SkillMenu } from "./SkillMenu";
import { ContextRing, type ContextStatus } from "./ContextRing";
import { COMPACT_COMMAND, isCompactCommand } from "@/lib/compact";
import { slashAt, type SlashState } from "@/lib/slash";
import { useInlineTags } from "@/hooks/useInlineTags";
import { smartJoin, useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton, VoicePill } from "@/components/ui/voice-button";
import { cn } from "@/lib/utils";

/**
 * The composer.
 *
 * One input, one destination: the AGENT doing the work. Sending to it is always allowed — if the
 * agent is mid-turn the controller queues the message and delivers it the moment the current turn
 * ends, and the thread shows it as "queued" until then. Answering a paused question goes through
 * the question card, so the composer never has to explain "this releases the run". Questions ABOUT
 * the run go to the side chat, its own surface with its own input; the toolbar only opens it.
 *
 * `@` opens the workspace file picker and `/` the skills; what is picked is written into the message
 * where the caret is and drawn as a pill in the line, so one message can name several skills and
 * files, each in the sentence about it. Mentions are also spelled out as full paths for the agent.
 */
export function SendBar({
  boxName,
  runState,
  sleeping = false,
  repos = [],
  onOpenSideChat,
  onReplied,
  onQueued,
  onFocusRequest,
  seed,
  onReplyFailed,
  canCompact,
  context,
  phase,
  top,
}: {
  /** What the thread is in the middle of, for the composer's copy: a run being set up, a question
   *  waiting on the card above, or a box that has never run anything. */
  phase?: "starting" | "asked" | "fresh";
  /** The first row inside the composer's surface (the changed-files dock), above the text. */
  top?: React.ReactNode;
  boxName: string;
  runState: RunState;
  sleeping?: boolean;
  repos?: { name: string; branch?: string }[];
  /** Open the side chat (a read-only helper answering about the run). Hidden while asleep. */
  onOpenSideChat?: () => void;
  onReplied: (text: string) => void;
  onQueued?: () => void;
  onFocusRequest?: (focus: () => void) => void;
  /** The server could not deliver this reply: the parent drops the optimistic echo. */
  onReplyFailed?: (text: string) => void;
  /** This thread's agent takes `/compact` (Claude Code): the slash menu offers it. */
  canCompact?: boolean;
  /** The context window ring beside the send button (once a turn reported usage). */
  context?: ContextStatus | null;
  /** Text to drop into the composer (e.g. a starter prompt); `n` changes to re-apply the same text.
   *  `append` adds it after a non-empty draft instead of replacing it (a quoted selection). */
  seed?: { text: string; n: number; append?: boolean; /** Joins the current line (a tag) instead of starting a paragraph. */ inline?: boolean; /** A picture that arrives with the text (a browser element, a screenshot). */ image?: { name: string; dataUrl: string; label?: string; note?: string } } | null;
}) {
  const busy = runState === "running" && !sleeping;
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
  // Images pasted, dropped or picked: kept as data URLs for the preview, uploaded into the sandbox on
  // send (/workspace/.attachments) and referenced in the message so the agent opens them with Read.
  // `label` is what the chip is called; `note` is what the agent is told about the picture (a browser
  // element's selector and markup). Neither is prose the person has to read or keep in their message.
  const [images, setImages] = React.useState<{ id: string; name: string; dataUrl: string; size: number; label?: string; note?: string }[]>([]);
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
  const textarea = () => document.getElementById("send-input") as HTMLTextAreaElement | null;
  // Skills and files are tags in the text itself, drawn as pills where they sit in the line.
  const tags = useInlineTags(value, setValue, textarea);
  // `/compact` is offered only where it can run: first thing in the message, on a Claude Code thread.
  const slashCommands = React.useMemo(
    () => (canCompact && slash && value.slice(0, slash.start).trim() === "" ? [COMPACT_COMMAND] : []),
    [canCompact, slash, value]
  );
  // The whole message is a command typed out in full: Enter sends it instead of re-picking it.
  const typedCommand = !!slash && value.trim() === `/${slash.query}` && slashCommands.some((c) => c.name === slash.query);

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
    // A seed that is only a picture (a browser element) leaves the words being written alone.
    if (seed.text || !seed.image) setValue((prev) => (seed.inline ? `${prev && !/\s$/.test(prev) ? `${prev} ` : prev}${seed.text} ` : seed.append && prev.trim() ? `${prev.trimEnd()}\n\n${seed.text}` : seed.text));
    const image = seed.image;
    if (image) setImages((prev) => [...prev, { id: `${seed.n}-${prev.length}`, name: image.name, dataUrl: image.dataUrl, size: Math.round(image.dataUrl.length * 0.75), label: image.label, note: image.note }]);
    requestAnimationFrame(() => {
      const t = textarea();
      if (!t) return;
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    });
  }, [seed]);
  const still = useReducedMotion();
  // A phone's keyboard has no Shift+Enter: there Enter is a new line and the arrow sends.
  const touch = useMediaQuery("(pointer: coarse) and (hover: none)");
  // Up in an empty composer walks back through what was sent to this thread; the index is only
  // meaningful while the text is still exactly the recalled message.
  const recall = React.useRef<number | null>(null);
  const recallKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return false;
    const sentBefore = readSent(boxName);
    const at = recall.current !== null && sentBefore[recall.current] === value ? recall.current : null;
    if (at === null && (e.key === "ArrowDown" || value !== "" || !sentBefore.length)) return false;
    const next = at === null ? sentBefore.length - 1 : at + (e.key === "ArrowUp" ? -1 : 1);
    if (next < 0) return true; // already at the oldest: stay, and keep the caret from jumping
    recall.current = next < sentBefore.length ? next : null;
    setValue(sentBefore[next] ?? "");
    return true;
  };
  // One slot, four faces: the icon morphs between them rather than swapping.
  const sendIcon = sending ? "sending" : sent ? "sent" : busy ? "queue" : "send";

  // Escape on a menu means "not this one": the `@`/`/` token it belonged to stays plain text. The
  // menus are re-derived from the caret on every key-up, so without this the key-up of that very
  // Escape reopened the menu it had just closed — the menu could not be dismissed, and the next
  // Enter picked a file instead of sending.
  const dismissed = React.useRef<{ mention?: number; slash?: number }>({});
  const updateMention = (next: string) => {
    const el = textarea();
    const caret = el?.selectionStart ?? next.length;
    // The caret resting against a tag a menu just wrote is not a request to pick again.
    if (tags.atPicked(next, caret)) {
      setMention(null);
      setSlash(null);
      return;
    }
    const m = mentionAt(next, caret);
    if (!m || m.start !== dismissed.current.mention) dismissed.current.mention = undefined;
    setMention(m && m.start === dismissed.current.mention ? null : m);
    const s = slashAt(next, caret);
    if (!s || s.start !== dismissed.current.slash) dismissed.current.slash = undefined;
    setSlash(s && s.start === dismissed.current.slash ? null : s);
  };

  /** The end of the `/query` or `@query` being typed: up to the next space, wherever the caret is. */
  const tokenEnd = (start: number) => {
    const ws = value.slice(start).search(/\s/);
    return ws === -1 ? value.length : start + ws;
  };

  const pickSkill = (name: string) => {
    // The `/query` being typed becomes the full tag, in place; the rest of the message is untouched.
    if (slash) tags.insert(`/${name}`, slash.start, tokenEnd(slash.start));
    else tags.insert(`/${name}`);
    setSlash(null);
  };

  const pickFile = (path: string) => {
    if (!mention) return;
    tags.insert(`@${path}`, mention.start, tokenEnd(mention.start));
    setMention(null);
  };

  const send = async () => {
    const text = value.trim();
    if ((!text && !images.length) || sending) return;
    if (readersInFlight.current > 0) {
      // A pasted image is still decoding; sending now would drop it. Retry (via the ref, so the
      // retry sees the state that includes the decoded image) once the reader lands.
      setTimeout(() => sendRef.current(), 60);
      return;
    }
    const compact = isCompactCommand(text);
    if (compact && images.length) {
      toast.error("Send /compact on its own", { description: "Images go with a normal message — remove them, or send them after the compaction." });
      return;
    }
    voice.stop();
    setSending(true);
    setError(null);
    const attachedImages = images;
    // The tags travel as written: the controller reads every `/skill` in the message, and each
    // `@path` is also spelled out as a full path so the agent opens the right file.
    let message = expandMentions(text).trim();
    try {
      // Upload images first so the message can name their in-box paths.
      let imagesTail = "";
      if (attachedImages.length) {
        const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
        const paths: string[] = [];
        for (const [i, img] of attachedImages.entries()) {
          const rel = `${ATTACHMENTS_DIR}/${stamp}-${i + 1}-${img.name}`;
          await api.writeFile(boxName, rel, img.dataUrl, "base64");
          paths.push(`/workspace/${rel}${img.note ? `\n  ${img.note}` : ""}`);
        }
        imagesTail = `Attached ${paths.length === 1 ? "image" : "images"} (open with the Read tool):\n${paths.map((p) => `- ${p}`).join("\n")}`;
        message = `${message}${message ? "\n\n" : ""}${imagesTail}`;
      }
      setValue("");
      setImages([]);
      tags.reset();
      recall.current = null;
      // Echo NOW. The controller wakes/kicks the run in a few seconds; a message that only appears
      // when the server answers reads as a broken chat. The echo is withdrawn if delivery fails,
      // and the durable ⟦you⟧ line in the log replaces it once it lands. The echo IS the delivered
      // message, byte for byte: a prettier paraphrase (files as `@path`, no path list) never
      // matched its own log line, so every send with a file chip left a second bubble behind for
      // good. The bubble turns the machinery back into chips for the echo and the log line alike.
      const echo = message;
      if (!busy) onReplied(echo);
      try {
        // The picked model rides the send once; the server makes it sticky for the box.
        const res = await api.resume(boxName, message, model.picked ? { model: model.picked } : {});
        if ("queued" in res && res.queued) {
          if (!busy) onReplyFailed?.(echo);
          onQueued?.();
          toast(compact ? "Compaction queued" : "Sent to the agent", {
            description: compact
              ? "It runs as its own turn once the agent finishes this one."
              : "It is mid-turn. It reads your message at its next step and replies in the thread.",
            icon: <Clock className="size-4" />,
          });
        }
      } catch (e) {
        if (!busy) onReplyFailed?.(echo);
        throw e;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Also straight to storage: if the thread was left while this was in flight, the component
      // is gone and the state update below is a no-op — the words must still be there on return.
      writeDraft(boxName, text);
      setValue(text);
      setImages(attachedImages);
      toast.error("Could not send", { description: msg });
      setSending(false);
      return;
    }
    pushSent(boxName, text);
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
      : busy
        ? "Agent is mid-turn — it reads your message at its next step."
        : phase === "starting"
          ? "Starting up — type ahead, it is delivered once the agent is listening."
          : phase === "asked"
            ? "Pick an option above, or answer here — it reaches the agent as your answer."
            : touch
              ? null // the arrow and the + say it themselves; a phone has no line to spare for it
              : "Enter to send · Shift+Enter for a new line · Up recalls your last message";

  return (
    <div className="pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* Same column as the conversation and the changes dock: max-w-3xl with the same inner gutter. */}
      <div className="relative mx-auto min-w-0 max-w-3xl px-3 md:px-6">
        <VoicePill state={voice.state} interim={voice.interim} />
        <AnimatePresence initial={false}>
          {mention && <MentionMenu key="mention" session={boxName} repos={repos} state={mention} onPick={pickFile} onClose={() => (mention && (dismissed.current.mention = mention.start), setMention(null))} />}
          {!mention && slash && <SkillMenu key="skill" state={slash} commands={slashCommands} onPick={pickSkill} onClose={() => (slash && (dismissed.current.slash = slash.start), setSlash(null))} onMatches={setSlashMatches} />}
        </AnimatePresence>
        <PromptInput
          value={value}
          onValueChange={(v) => {
            setValue(v);
            updateMention(v);
            // The caption under the composer is about the LAST attempt; a new edit retires it.
            if (error) setError(null);
          }}
          enterSends={!touch}
          onSubmit={() => {
            if (mention) return; // Enter inside the mention menu picks a file
            if (slash && slashMatches > 0 && !typedCommand) return; // Enter inside the skill menu picks a skill
            void send();
          }}
          isLoading={sending}
          className={cn(
            "bg-card composer-focus composer-depth border-line-strong rounded-2xl p-2",
            sleeping && "border-sleep/50",
            dragOver && "border-live ring-live/40 ring-2",
            (voice.state === "listening" || voice.state === "arming") && "mic-live"
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
          {top}
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
                  <span className="stamp absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-px text-[9px] text-white">{img.label ?? img.name}</span>
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
            Message the agent
          </label>
          <PromptInputTextarea
            id="send-input"
            className="px-2.5 pt-2 text-body"
            tokens={tags.tokens}
            onKeyDown={(e) => {
              if (tags.onKeyDown(e)) {
                setMention(null);
                setSlash(null);
                return;
              }
              const nav = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key);
              if (!nav) return;
              // An IME's own Enter/arrows (choosing a candidate) are never ours to act on.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (!mention && !(slash && slashMatches > 0) && recallKey(e)) return e.preventDefault();
              if (mention) {
                e.preventDefault();
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent("asb:mention-nav", { detail: e.key }));
              } else if (slash && slashMatches > 0 && !(typedCommand && e.key === "Enter")) {
                e.preventDefault();
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent("asb:skill-nav", { detail: e.key }));
              }
            }}
            onKeyUp={() => updateMention(value)}
            onClick={() => updateMention(value)}
            placeholder={
              sleeping
                ? "Type ahead — sends once the sandbox is awake…"
                : busy
                  ? "Say something — the agent reads it at its next step…"
                  : phase === "fresh"
                    ? "Describe a task for this machine…"
                    : phase === "starting"
                      ? "Type ahead — delivered once the agent is listening…"
                      : phase === "asked"
                        ? "Answer in your own words…"
                        : "Send a follow-up…  ( / skills, @ files )"
            }
          />
          {/* One row, never two: everything is nowrap and the tool cluster can shrink (min-w-0) so the
              send button always keeps its place at the right edge — on a phone as much as beside an
              open workspace pane. */}
          {/* The shared toolbar (components/composer/Toolbar.tsx): + / @ · Ask the sandbox · Model … voice
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
                    selected={tags.skillNames}
                    onPick={(name) => {
                      tags.toggleSkill(name);
                      setSlash(null);
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
                  {onOpenSideChat && !sleeping && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <ToolButton
                          icon={<MessageCircleQuestion />}
                          aria-label="Ask the sandbox"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSideChat();
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">Ask the sandbox about this run — the agent is not interrupted</TooltipContent>
                    </Tooltip>
                  )}
                  <ModelMenu {...menus.props("model")} model={modelOptions} disabled={sending} />
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
                  {context && !sleeping && <ContextRing status={context} />}
                  {voice.supported && <VoiceButton state={voice.state} level={voice.level} onToggle={voice.toggle} />}
            <Button
              variant="primary"
              size="icon"
              onClick={send}
              disabled={sending || (!value.trim() && !images.length)}
              aria-label={busy ? "Queue for the agent" : "Send to the agent"}
              className="no-press shrink-0 rounded-full transition-[opacity,scale,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out-quint)] disabled:opacity-35 enabled:hover:scale-105 enabled:active:scale-90 motion-reduce:enabled:hover:scale-100 motion-reduce:enabled:active:scale-100"
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
        <p hidden={!error && !hint} className={cn("mt-1.5 min-h-4 px-2 text-center text-micro line-clamp-2 sm:line-clamp-none sm:truncate sm:text-left", error ? "text-destructive" : "text-faint")} role={error ? "alert" : undefined} title={error ?? hint ?? undefined}>
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
