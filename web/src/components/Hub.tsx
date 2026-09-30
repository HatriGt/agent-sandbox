import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bug,
  ClipboardCheck,
  FileSearch,
  FlaskConical,
  GitBranch,
  GitPullRequest,
  Layers,
  Loader2,
  ImagePlus,
  Lock,
  Map,
  PencilLine,
  Plus,
  ShieldCheck,
  Sparkles,
  TestTubes,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { RepoPicker, type PickedRepo } from "@/components/RepoPicker";
import { ModelChip, useModelChoice, type ModelChoice } from "@/components/thread/ModelPicker";
import { BudgetChip } from "@/components/thread/BudgetChip";
import { HarnessChip } from "@/components/harness/HarnessChip";
import type { RunBudget } from "@/lib/api";
import { useProviders } from "@/components/Providers";
import { AgentChip, useAgentChoice } from "@/components/DriverPicker";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Collapse } from "@/components/ui/collapse";
import { StaggerItem } from "@/components/ui/swap";
import { api, type BoxView, type FleetLifecycle } from "@/lib/api";
import { fmtAgo, friendlyName, shortName, threadSort, threadTitle } from "@/lib/format";
import { readDraft, takePrefill, writeDraft } from "@/lib/draft";
import { STARTERS as STARTER_DEFS, mergeStarterText, type StarterDef } from "@/lib/starters";
import { getMe } from "@/lib/auth";
import { GettingStarted, gettingStartedDismissed } from "@/components/GettingStarted";
import { TrialEndedNotice } from "@/components/TrialBadge";
import { displayState, fmtDuration } from "@/lib/lifecycle";
import { questionHeadline } from "@/lib/question";
import { prefetchWatch } from "@/hooks/useWatchStream";
import { Button } from "@/components/ui/button";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import { StateStamp } from "@/components/ui/stamp";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { Lightbox } from "@/components/ui/lightbox";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Capacity } from "@/components/Capacity";
import { Bar } from "@/components/thread/Skeletons";
import { smartJoin, useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton, VoicePill } from "@/components/ui/voice-button";
import { cn } from "@/lib/utils";
import type { SessionRun } from "@/hooks/useSessionRuns";

/**
 * The hub: what you see with no machine selected.
 *
 * Starting a run is the primary act of this product, so the composer is the first thing on the page,
 * top-anchored so nothing jumps when the lists below change. Under it: the live fleet with its
 * capacity, because the hub is also where you glance to know whether anything needs you; then the
 * runs this browser started, honest about the ones whose machines are gone.
 */

interface Starter extends StarterDef {
  icon: React.ReactNode;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// The briefs live in lib/starters.ts (pure data, tested); the icons are presentation and stay here.
const STARTER_ICONS: Record<string, React.ReactNode> = {
  "Explain a codebase": <FileSearch />,
  "Fix a bug, open a PR": <Bug />,
  "Run the tests": <FlaskConical />,
  "Review a diff": <ClipboardCheck />,
  "Review a PR": <GitPullRequest />,
  "Plan first, then build": <Map />,
  "TDD a feature": <TestTubes />,
  "Research, no repo": <Layers />,
};

const STARTERS: Starter[] = STARTER_DEFS.map((s) => ({ ...s, icon: STARTER_ICONS[s.label] ?? <Layers /> }));

/**
 * A failed delegate unmounts and remounts the Hub (the booting pane swaps in the moment you submit),
 * so React state written after the failure lands on a dead instance. Everything the user would lose
 * — images, repos, verify clause, the error itself — is stashed here at module level and restored by
 * the next mount. One-shot, in-memory: a reload starts clean (the text draft alone survives, as before).
 */
interface FailedSubmit {
  task: string;
  images: { id: string; name: string; dataUrl: string }[];
  picked: PickedRepo[];
  verify?: { mode: "command" | "criterion"; text: string };
  error: string;
}
let failedSubmit: FailedSubmit | null = null;
function takeFailedSubmit(): FailedSubmit | null {
  const s = failedSubmit;
  failedSubmit = null;
  return s;
}

/**
 * One honest sentence about the fleet right now, built only from live data. The counts tick
 * (NumberTicker) so a poll that changes "2 working" to "3 working" reads as a change, not a reprint;
 * the slot count in the "full" tail is configuration and stays plain.
 */
function fleetLine(boxes: BoxView[], lc: FleetLifecycle): React.ReactNode {
  const waiting = boxes.filter((b) => b.runState === "waiting").length;
  const working = boxes.filter((b) => b.runState === "running" && displayState(b) === "running").length;
  const warm = boxes.filter((b) => b.role === "pool-free" && displayState(b) === "idle").length;
  const up = boxes.filter((b) => displayState(b) !== "sleeping").length;
  const parts: React.ReactNode[] = [];
  if (waiting)
    parts.push(
      <React.Fragment key="waiting">
        <NumberTicker value={waiting} from={waiting} className="text-foreground font-medium" /> {waiting === 1 ? "machine needs" : "machines need"} your answer
      </React.Fragment>
    );
  if (working)
    parts.push(
      <React.Fragment key="working">
        <NumberTicker value={working} from={working} className="text-foreground font-medium" /> working
      </React.Fragment>
    );
  const full = lc.capacity > 0 && up >= lc.capacity;
  const tail = full
    ? `All ${lc.capacity} slots are in use — finish or destroy a machine to start another.`
    : warm
      ? "A warm machine is ready, so a new task starts in seconds."
      : "No warm machine right now — a fresh sandbox boots in a few seconds.";
  if (!parts.length) return tail;
  return (
    <>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && ", "}
          {p}
        </React.Fragment>
      ))}
      . {tail}
    </>
  );
}

/**
 * The first-run strip: how the product works in one line of three steps, shown above the composer
 * until the first task has been started from this browser (then remembered in localStorage, so it
 * never comes back on a reload). Not a tour — one glance, then out of the way.
 */
const HOWTO_KEY = "asb-hub-howto-done";
function howtoDone(): boolean {
  try {
    return localStorage.getItem(HOWTO_KEY) === "1";
  } catch {
    return false;
  }
}
function markHowtoDone() {
  try {
    localStorage.setItem(HOWTO_KEY, "1");
  } catch {
    /* storage blocked: the strip hides for this mount only */
  }
}
const HOWTO_STEPS = [
  { icon: <PencilLine />, title: "Describe a task", body: "in plain words, with a repo if it needs one" },
  { icon: <Sparkles />, title: "An agent works on it", body: "in a fresh sandbox, watched live" },
  { icon: <GitPullRequest />, title: "Review the PR", body: "diff, checks and merge, right here" },
];
function HowItWorks({ open }: { open: boolean }) {
  const still = useReducedMotion();
  return (
    <Collapse open={open}>
      <motion.ol
        aria-label="How it works"
        initial={still ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="mb-4 grid grid-cols-1 gap-1.5 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center sm:gap-1"
      >
        {HOWTO_STEPS.map((s, i) => (
          <React.Fragment key={s.title}>
            {i > 0 && (
              <li aria-hidden className="text-faint hidden justify-center sm:flex">
                <ArrowRight className="size-3.5" />
              </li>
            )}
            <li className="min-w-0">
              <StaggerItem index={i} step={0.06} className="bg-muted/60 flex items-start gap-2.5 rounded-lg px-3 py-2">
                <span className="bg-background text-muted-foreground mt-0.5 grid size-6 shrink-0 place-items-center rounded-full [&_svg]:size-3" aria-hidden>
                  {s.icon}
                </span>
                <span className="min-w-0">
                  <span className="text-foreground block text-meta leading-snug font-medium">{s.title}</span>
                  <span className="text-muted-foreground block text-micro leading-snug">{s.body}</span>
                </span>
              </StaggerItem>
            </li>
          </React.Fragment>
        ))}
      </motion.ol>
    </Collapse>
  );
}

export function Hub({
  boxes,
  lifecycle,
  loading,
  offline = false,
  sessionRuns,
  onBooting,
  onStarted,
  onFailed,
  onPending,
  onSettled,
  onOpen,
  onBack,
}: {
  boxes: BoxView[];
  lifecycle: FleetLifecycle;
  loading: boolean;
  /** The fleet poll is failing and nothing has been received: the sentence must not promise a machine. */
  offline?: boolean;
  sessionRuns: SessionRun[];
  onBooting: (task: string) => void;
  onStarted: (box: string, task: string, inferred?: string[]) => void;
  onFailed: () => void;
  onPending: (p: { id: string; task: string }) => void;
  onSettled: (id: string) => void;
  onOpen: (name: string) => void;
  onBack: () => void;
}) {
  // A handoff from a finished run wins; then a failed submit's stash; otherwise whatever was typed
  // before a reload or detour. takePrefill is consumed lazily ONCE — evaluating it on every render
  // would eat a prefill written while the Hub is mounted.
  const [prefillOnce] = React.useState(() => takePrefill());
  const prefill = React.useRef(prefillOnce);
  const [stash] = React.useState(() => takeFailedSubmit());
  const [task, setTask] = React.useState(() => prefill.current?.task ?? (stash?.task || readDraft("hub")));
  const [picked, setPicked] = React.useState<PickedRepo[]>(() => stash?.picked ?? []);
  // Model for message 1 — the "new-task" scope key keeps it distinct from any box's sticky pick.
  const model = useModelChoice("new-task");
  const agent = useAgentChoice();
  // The user's own providers (Providers page) join the picker, grouped by provider label.
  const providers = useProviders();
  const [provPick, setProvPick] = React.useState<ModelChoice | null>(null);
  const [budget, setBudget] = React.useState<RunBudget | null>(null);
  const [harness, setHarness] = React.useState<string | null>(null);
  const provModels = React.useMemo<ModelChoice[]>(
    () => (providers?.providers ?? []).flatMap((p) => (p.models ?? []).map((id) => ({ id, label: id, tier: "other" as const, group: p.label, provider: p.id }))),
    [providers]
  );
  const pickerModels = React.useMemo(
    () => (provModels.length ? [...model.models.map((m) => ({ ...m, group: "Deployment" })), ...provModels] : model.models),
    [model.models, provModels]
  );
  const pickModel = (m: ModelChoice) => {
    if (m.provider) setProvPick(m);
    else {
      setProvPick(null);
      model.pick(m);
    }
  };
  const [showRepo, setShowRepo] = React.useState(() => !!prefill.current?.wantsRepo);
  React.useEffect(() => writeDraft("hub", task), [task]);
  // Re-attach the source run's repositories: each checkout name is looked up across your accounts and
  // pre-picked when exactly one repository matches; anything ambiguous falls back to the picker.
  React.useEffect(() => {
    const want = prefill.current?.repos ?? [];
    if (!want.length) return;
    let cancelled = false;
    Promise.all(
      want.map((w) =>
        api
          .repos(w.name)
          .then((r) => {
            const hits = r.repos.filter((x) => x.fullName.split("/")[1]?.toLowerCase() === w.name.toLowerCase());
            const pick: PickedRepo | null = hits.length === 1 ? { repo: hits[0].fullName, ref: w.branch && w.branch !== hits[0].defaultBranch ? w.branch : undefined, defaultBranch: hits[0].defaultBranch, private: hits[0].private } : null;
            return pick;
          })
          .catch(() => null)
      )
    ).then((found) => {
      if (cancelled) return;
      const ok = found.filter((x): x is PickedRepo => !!x);
      if (ok.length) setPicked((prev) => [...prev, ...ok.filter((o) => !prev.some((p) => p.repo.toLowerCase() === o.repo.toLowerCase()))]);
      if (ok.length < want.length) setShowRepo(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  React.useEffect(() => {
    if (!prefill.current) return;
    requestAnimationFrame(() => {
      const el = document.getElementById("new-task") as HTMLTextAreaElement | null;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);
  const pickerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!showRepo) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowRepo(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showRepo]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(() => stash?.error ?? null);

  // Optional post-run verification: a command run in the sandbox, or a criterion a read-only checker
  // judges. Collapsed by default so the composer stays clean; the chip lights up when filled.
  const [verifyOpen, setVerifyOpen] = React.useState(() => !!stash?.verify);
  const [verifyMode, setVerifyMode] = React.useState<"command" | "criterion">(() => stash?.verify?.mode ?? "command");
  const [verifyText, setVerifyText] = React.useState(() => stash?.verify?.text ?? "");
  const verifyActive = verifyText.trim().length > 0;
  const clearVerify = () => {
    setVerifyOpen(false);
    setVerifyText("");
  };

  // Dictation into the task box: finalized phrases land at the caret; sending stays manual.
  const voice = useVoiceInput({
    onFinal: (spoken) => {
      setTask((prev) => {
        const el = document.getElementById("new-task") as HTMLTextAreaElement | null;
        const caret = el && document.activeElement === el ? (el.selectionStart ?? prev.length) : prev.length;
        const glue = smartJoin(prev.slice(0, caret), spoken);
        const next = prev.slice(0, caret) + glue + prev.slice(caret);
        requestAnimationFrame(() => {
          const t = document.getElementById("new-task") as HTMLTextAreaElement | null;
          if (!t) return;
          const pos = caret + glue.length;
          t.setSelectionRange(pos, pos);
        });
        return next;
      });
    },
  });

  const applyStarter = (s: Starter) => {
    // Never destroy a typed brief: if the composer already holds text that is not just another
    // starter, append the template under it instead of replacing it (lib/starters.ts).
    setTask((prev) => mergeStarterText(prev, s.task));
    if (s.needsRepo) setShowRepo(true);
    requestAnimationFrame(() => {
      const el = document.getElementById("new-task") as HTMLTextAreaElement | null;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  // Images pasted, dropped or picked go with the task: the controller stages them into the fresh
  // sandbox before the agent starts, and the task names them for the Read tool.
  const [images, setImages] = React.useState<{ id: string; name: string; dataUrl: string }[]>(() => stash?.images ?? []);
  const [preview, setPreview] = React.useState<{ name: string; dataUrl: string } | null>(null);
  // dragenter/dragleave fire for every child crossed, so a boolean flickers as the cursor moves
  // over the textarea and buttons. A depth counter only reaches zero when the drag truly leaves.
  const [dragOver, setDragOver] = React.useState(false);
  const dragDepth = React.useRef(0);
  const hasImages = (dt: DataTransfer) => [...dt.items].some((i) => i.type.startsWith("image/"));
  const endDrag = () => {
    dragDepth.current = 0;
    setDragOver(false);
  };
  const still = useReducedMotion();
  const fileInput = React.useRef<HTMLInputElement>(null);
  // The 3-step strip stays until this browser has started a task (see HowItWorks).
  const [howto, setHowto] = React.useState(() => !howtoDone());
  const [gsDismissed, setGsDismissed] = React.useState(gettingStartedDismissed);
  const finishHowto = () => {
    markHowtoDone();
    setHowto(false);
  };
  // Files still being read when Enter lands would be silently dropped from the submit; count the
  // in-flight reads so submit can hold until they land (they take milliseconds).
  const [readsPending, setReadsPending] = React.useState(0);
  const addImages = (list: Iterable<File>) => {
    for (const f of list) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`${f.name || "image"} is over 8 MB`);
        continue;
      }
      const reader = new FileReader();
      setReadsPending((n) => n + 1);
      reader.onerror = () => setReadsPending((n) => n - 1);
      reader.onload = () => {
        setReadsPending((n) => n - 1);
        const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const stem = (f.name || "pasted").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 40) || "image";
        setImages((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: `${stem}.${ext}`, dataUrl: String(reader.result) }]);
      };
      reader.readAsDataURL(f);
    }
  };

  const submit = async () => {
    const t = task.trim();
    if ((!t && !images.length) || busy) return;
    if (readsPending > 0) {
      // An image is still being read; submitting now would silently drop it. The read resolves in
      // milliseconds — ask for one more Enter rather than auto-firing with state that may have moved.
      toast("One moment — still attaching your image", { icon: <ImagePlus className="size-4" /> });
      return;
    }
    voice.stop();
    const id = `pending-${Date.now()}`;
    setBusy(true);
    setError(null);
    const attached = images;
    onPending({ id, task: t });
    onBooting(t);
    try {
      const res = await api.delegate({
        task: t,
        repos: picked.length ? picked.map((p) => ({ repo: p.repo, ref: p.ref || undefined })) : undefined,
        attachments: attached.length ? attached.map((i) => ({ name: i.name, dataUrl: i.dataUrl })) : undefined,
        ...(provPick ? { model: provPick.id, provider: provPick.provider } : model.picked ? { model: model.picked } : {}),
        // The agent chip shows "partial" before the pick is sent, so choosing it IS the acknowledgement.
        ...(agent.picked ? { agent: agent.picked, ...(agent.current?.supervised === false ? { allowPartialSupervision: true } : {}) } : {}),
        ...(budget ? { budget } : {}),
        ...(harness ? { harness } : {}),
        ...(verifyActive ? { verify: verifyMode === "command" ? { command: verifyText.trim() } : { criterion: verifyText.trim() } } : {}),
      });
      if (res.ok) {
        // Accepted. The Hub is already UNMOUNTED here (onBooting swapped in the booting pane), so the
        // setState calls below are no-ops on a dead instance and the draft effect never fires — clear
        // the stored draft directly, or the next new-task composer comes prefilled with this brief.
        writeDraft("hub", "");
        finishHowto();
        setTask("");
        setImages([]);
        clearVerify();
        // Repos inferred from the task ride along to render INLINE in the booting pane/thread —
        // right under the task, where the reader is looking — not as a toast over a random corner.
        onStarted(res.box, t, res.inferred);
      } else {
        // The Hub was swapped out for the booting pane, so setError would land on a dead instance.
        // Stash everything for the remount that onFailed triggers; the toast covers the gap.
        failedSubmit = {
          task: t,
          images: attached,
          picked,
          ...(verifyActive ? { verify: { mode: verifyMode, text: verifyText } } : {}),
          error: res.question,
        };
        onFailed();
        setError(res.question);
        toast.error("Could not start the task", { description: res.question });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failedSubmit = {
        task: t,
        images: attached,
        picked,
        ...(verifyActive ? { verify: { mode: verifyMode, text: verifyText } } : {}),
        error: msg,
      };
      onFailed();
      setError(msg);
      toast.error("Could not start the task", { description: msg });
    } finally {
      onSettled(id);
      setBusy(false);
    }
  };

  const live = new Set(boxes.map((b) => b.name));
  const fleet = [...boxes].sort(threadSort);
  const runs = fleet.filter((b) => b.role !== "pool-free");
  // Anyone who already has runs (from another browser, or before this flag existed) has seen the
  // loop work; don't teach it to them.
  const firstRun = howto && !loading && runs.length === 0 && sessionRuns.length === 0;
  React.useEffect(() => {
    if (howto && !loading && (runs.length > 0 || sessionRuns.length > 0)) finishHowto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [howto, loading, runs.length, sessionRuns.length]);

  return (
    <div className="hub-stage h-full min-w-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-16 md:px-6 md:pt-[8vh]">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
            <ArrowLeft className="size-4" />
            Machines
          </Button>
          <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em] text-balance">
            {greeting()}
          </h1>
          {loading ? (
            <div className="mt-3 flex flex-col gap-2">
              <Bar className="h-3 w-[70%]" />
              <Bar className="h-3 w-[40%]" />
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 max-w-[56ch] text-body">
              {offline
                ? boxes.length
                  ? "The controller isn't answering — this is the last snapshot. A new task starts as soon as it's back."
                  : "The fleet can't be reached right now. Your task is kept here until the connection comes back."
                : fleetLine(boxes, lifecycle)}
            </p>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}>
          <TrialEndedNotice />
          <HowItWorks open={firstRun} />
          <div className="relative">
          <VoicePill state={voice.state} interim={voice.interim} />
          <PromptInput
            value={task}
            onValueChange={setTask}
            onSubmit={getMe()?.kind === "user" && (getMe() as { expired?: boolean }).expired ? () => {} : submit}
            isLoading={busy}
            className={cn(
              "bg-card border-line-strong composer-depth focus-within:border-live/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--live)_18%,transparent),0_1px_2px_oklch(0_0_0/0.05),0_8px_24px_-16px_oklch(0_0_0/0.25)] relative rounded-2xl p-2.5 transition-[border-color,box-shadow] duration-200",
              dragOver && "border-live",
              (voice.state === "listening" || voice.state === "arming") && "mic-glow"
            )}
            onPaste={(e) => {
              const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
              if (files.length) {
                e.preventDefault();
                addImages(files);
              }
            }}
            onDragEnter={(e) => {
              if (!hasImages(e.dataTransfer)) return;
              e.preventDefault();
              dragDepth.current += 1;
              setDragOver(true);
            }}
            onDragOver={(e) => {
              if (hasImages(e.dataTransfer)) e.preventDefault();
            }}
            onDragLeave={() => {
              if (dragDepth.current === 0) return;
              dragDepth.current -= 1;
              if (dragDepth.current === 0) setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              endDrag();
              addImages(e.dataTransfer.files);
            }}
          >
            <label htmlFor="new-task" className="sr-only">
              Describe the task for a new machine
            </label>
            {/* The drop target is the WHOLE composer, said in words: a dashed veil over everything,
                pointer-events off so the drop still lands on the PromptInput underneath. */}
            <AnimatePresence>
              {dragOver && (
                <motion.div
                  key="drop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: still ? 0.08 : 0.15 }}
                  aria-hidden
                  className="bg-card/90 border-live text-live pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl border-2 border-dashed backdrop-blur-[2px]"
                >
                  <span className="flex items-center gap-2 text-meta font-medium">
                    <ImagePlus className="size-4" aria-hidden />
                    Drop images to attach
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 px-2 pt-1.5" onClick={(e) => e.stopPropagation()}>
                <AnimatePresence initial={false}>
                  {images.map((img) => (
                    <motion.span
                      key={img.id}
                      layout={!still}
                      initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="group relative block size-16 overflow-hidden rounded-md border"
                      title={img.name}
                    >
                      <button type="button" onClick={() => setPreview(img)} aria-label={`Preview ${img.name}`} className="block size-full cursor-zoom-in">
                        <img src={img.dataUrl} alt={img.name} className="size-full object-cover transition-transform duration-200 group-hover:scale-105" />
                      </button>
                      <button type="button" onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))} aria-label={`Remove ${img.name}`} className="bg-card/80 text-foreground hover:bg-card absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full opacity-0 shadow-e1 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                        <X className="size-3" />
                      </button>
                    </motion.span>
                  ))}
                </AnimatePresence>
              </div>
            )}
            <PromptInputTextarea
              id="new-task"
              placeholder="Describe a task. A fresh sandbox picks it up…"
              className="min-h-[4.5rem] px-2.5 pt-2 text-lead"
            />

            {picked.length > 0 && (
              <div className="enter mt-1 flex flex-wrap gap-1.5 px-1" onClick={(e) => e.stopPropagation()}>
                {picked.map((p) => (
                  <span key={p.repo} className="bg-muted/80 text-foreground inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent pr-1 pl-2 font-mono text-micro transition-colors focus-within:border-live/50">
                    {p.private && <Lock className="text-muted-foreground size-3" aria-label="private" />}
                    {p.repo}
                    <input
                      value={p.ref ?? ""}
                      onChange={(e) => setPicked((prev) => prev.map((x) => (x.repo === p.repo ? { ...x, ref: e.target.value } : x)))}
                      placeholder={p.defaultBranch ?? "branch"}
                      aria-label={`Branch for ${p.repo}`}
                      className="placeholder:text-faint text-live w-24 bg-transparent font-mono text-micro outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setPicked((prev) => prev.filter((x) => x.repo !== p.repo))}
                      aria-label={`Remove ${p.repo}`}
                      className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {verifyOpen && (
              <div className="enter border-t px-1 pt-2 pb-1 mt-1" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1.5">
                  <AnimatedTabs
                    ariaLabel="Verification mode"
                    className="shrink-0"
                    value={verifyMode}
                    onChange={setVerifyMode}
                    items={[
                      { value: "command", label: "Command" },
                      { value: "criterion", label: "Criterion" },
                    ]}
                  />
                  <input
                    value={verifyText}
                    onChange={(e) => setVerifyText(e.target.value)}
                    placeholder={verifyMode === "command" ? "npm test" : "what must be true when it's done"}
                    aria-label={verifyMode === "command" ? "Verification command" : "Verification criterion"}
                    className={cn(
                      "placeholder:text-faint text-foreground h-7 min-w-0 flex-1 bg-transparent px-1.5 outline-none",
                      verifyMode === "command" ? "stamp" : "text-meta"
                    )}
                  />
                  <button
                    type="button"
                    onClick={clearVerify}
                    aria-label="Remove verification"
                    className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-pointer place-items-center rounded"
                  >
                    <X className="size-3" />
                  </button>
                </div>
                <p className="text-muted-foreground mt-1 px-1 text-micro">
                  {verifyMode === "command"
                    ? "Runs in the sandbox after the agent finishes — exit 0 means verified."
                    : "A read-only checker judges this against the workspace — it cannot edit anything."}
                </p>
              </div>
            )}
            <PromptInputActions className="relative justify-between pt-1">
              <div ref={pickerRef} className="relative flex flex-wrap items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setShowRepo((v) => !v)}
                  aria-expanded={showRepo}
                  className={cn(
                    "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-micro font-medium transition-colors",
                    picked.length ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {picked.length ? <Plus className="size-3.5" aria-hidden /> : <GitBranch className="size-3.5" aria-hidden />}
                  {/* Phone: the action row has ~330px; the short label keeps every control on one line. */}
                  <span className="hidden sm:inline">{picked.length ? "Add another repo" : "Attach repos"}</span>
                  <span className="sm:hidden">{picked.length ? "Add repo" : "Repos"}</span>
                </button>
                <AgentChip choices={agent.choices} current={agent.current} defaultId={agent.defaultId} onPick={agent.pick} />
                <ModelChip current={provPick ?? model.current} models={pickerModels} defaultId={model.defaultId} onPick={pickModel} />
                <BudgetChip value={budget} onChange={setBudget} modelId={provPick ? undefined : (model.picked ?? model.defaultId)} />
                <HarnessChip value={harness} onChange={setHarness} />
                <button
                  type="button"
                  onClick={() => setVerifyOpen((v) => !v)}
                  aria-expanded={verifyOpen}
                  title="Verify the result after the run"
                  className={cn(
                    "h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-micro font-medium transition-colors",
                    // Phone: the row has ~330px and this is the advanced option — it stays reachable
                    // once set (the chip is lit) but doesn't push the send button onto a second line.
                    verifyActive ? "bg-muted text-foreground flex" : "text-muted-foreground hover:bg-muted hover:text-foreground hidden sm:flex"
                  )}
                >
                  <ShieldCheck className="size-3.5" aria-hidden />
                  Verify
                </button>
                {showRepo && (
                  <RepoPicker
                    className="absolute top-full left-0 z-20 mt-2"
                    selected={picked}
                    onToggle={(r) =>
                      setPicked((prev) =>
                        prev.some((p) => p.repo.toLowerCase() === r.fullName.toLowerCase())
                          ? prev.filter((p) => p.repo.toLowerCase() !== r.fullName.toLowerCase())
                          : [...prev, { repo: r.fullName, defaultBranch: r.defaultBranch, private: r.private }]
                      )
                    }
                    onClose={() => setShowRepo(false)}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInput.current?.click();
                }}
                aria-label="Attach an image"
                title="Attach an image — or paste / drop one"
                className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md transition-colors"
              >
                <ImagePlus className="size-3.5" />
              </button>
              {voice.supported && <VoiceButton state={voice.state} level={voice.level} onToggle={voice.toggle} />}
              <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => (addImages(e.target.files ?? []), (e.target.value = ""))} />
              <span className="min-w-0 flex-1" />
              <Button
                size="icon"
                onClick={submit}
                disabled={busy || (!task.trim() && !images.length) || !!(getMe()?.kind === "user" && (getMe() as { expired?: boolean }).expired)}
                aria-label="Start a machine with this task"
                className="rounded-full"
              >
                {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            </PromptInputActions>
          </PromptInput>
            {/* The hint is a caption under the composer: it read mid-sentence when squeezed into the action row. */}
            <p className={cn("mt-1.5 min-h-4 px-2 text-micro", error ? "text-destructive" : "text-faint")} role={error ? "alert" : undefined}>
              {error ??
                  (lifecycle.maxDurationSec
                    ? `Enter starts the machine · runs up to ${fmtDuration(lifecycle.maxDurationSec)}${lifecycle.idleTimeoutSec ? `, sleeps after ${fmtDuration(lifecycle.idleTimeoutSec)} quiet` : ""}`
                    : "Enter starts the machine · a repo named in the task is attached automatically")}
            </p>
          </div>
          <Lightbox src={preview?.dataUrl ?? null} name={preview?.name ?? ""} open={!!preview} onClose={() => setPreview(null)} />

          {/* Starters: one-tap briefs. Chips lift a hair on hover (hover-raise) — the same idiom as
              the composer's send button — and the icon warms to say "this is what you'd get". */}
          <div className="mt-3 flex flex-wrap gap-1.5" role="list" aria-label="Task starters">
            {STARTERS.map((s) => (
              <button
                key={s.label}
                type="button"
                role="listitem"
                onClick={() => applyStarter(s)}
                className="hover-raise bg-card text-muted-foreground hover:text-foreground hover:border-line-strong flex h-8 cursor-pointer items-center gap-1.5 rounded-full border pr-3 pl-2.5 text-meta [&_svg]:size-3.5 [&_svg]:text-faint [&_svg]:transition-colors [&_svg]:duration-150 hover:[&_svg]:text-live"
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>
        </motion.div>

        {!loading && runs.length === 0 && getMe()?.kind === "user" && <GettingStarted onDismiss={() => setGsDismissed(true)} />}
        {/* Offline: the headline already says the fleet can't be read; a "Nothing running" card
            under it would be a claim about machines we cannot see. While the checklist is up it
            already explains what appears here — one teaching card at a time. */}
        {!loading && !offline && runs.length === 0 && (getMe()?.kind !== "user" || gsDismissed) && (
          <motion.section
            aria-label="No runs yet"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-xl border border-dashed px-6 py-9 text-center"
          >
            <span className="bg-muted text-muted-foreground mx-auto mb-3 grid size-10 place-items-center rounded-full" aria-hidden>
              <Layers className="size-4" />
            </span>
            <p className="text-foreground text-meta font-medium">Nothing running</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-[30em] text-meta leading-relaxed">
              Describe a task above — with a repository if it needs one — and the machine that picks it up appears here while it works.
            </p>
            {lifecycle.capacity > 0 && (
              <div className="mt-4 flex justify-center">
                <Capacity boxes={boxes} capacity={lifecycle.capacity} size="sm" />
              </div>
            )}
          </motion.section>
        )}

        {(loading || runs.length > 0) && (
          <motion.section
            aria-labelledby="live-now"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between pb-2">
              <h2 id="live-now" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
                Live now
              </h2>
              {loading ? <Bar className="h-3 w-20" /> : <Capacity boxes={boxes} capacity={lifecycle.capacity} size="sm" />}
            </div>
            <ul className="bg-card divide-y overflow-hidden rounded-xl border">
              {loading
                ? [0, 1, 2].map((i) => (
                    <li key={i} className="flex items-center gap-3 px-3.5 py-3">
                      <Bar className="h-2.5 w-20" />
                      <Bar className="h-3 flex-1" />
                      <Bar className="h-2.5 w-16" />
                    </li>
                  ))
                : runs.map((b, i) => (
                    <li key={b.name} className="stagger-item" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                      <button
                        type="button"
                        onClick={() => onOpen(b.name)}
                        onMouseEnter={() => prefetchWatch(b.name)}
                        className="group hover:bg-muted/70 flex h-11 w-full cursor-pointer items-center gap-3 px-3.5 text-left transition-colors duration-150"
                      >
                        <StateStamp state={displayState(b)} exitCode={b.exitCode} stalled={b.stalled} className="w-24 shrink-0" />
                        <span className="text-foreground min-w-0 flex-1 truncate text-meta">
                          {b.runState === "waiting" && b.question ? questionHeadline(b.question) : threadTitle(b)}
                        </span>
                        {b.lastOutputAt && (
                          <span className={`${b.stalled ? "text-destructive" : "text-faint"} tabular hidden shrink-0 text-micro sm:inline`}>
                            {b.runState === "running" ? "last action " : ""}
                            {fmtAgo(b.lastOutputAt)}
                          </span>
                        )}
                        {/* Phone: the task wins the row; the machine name is on the thread it opens. */}
                        <span className="stamp text-muted-foreground hidden shrink-0 sm:inline" title={shortName(b.name)}>
                          {friendlyName(b.name)}
                        </span>
                        <ArrowRight className="text-muted-foreground size-3.5 shrink-0 -translate-x-0.5 opacity-0 transition-[opacity,translate] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
                      </button>
                    </li>
                  ))}
            </ul>
          </motion.section>
        )}

        {sessionRuns.length > 0 && (
          <motion.section
            aria-labelledby="started-here"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-baseline justify-between pb-2">
              <h2 id="started-here" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
                Started from this browser
              </h2>
              <span className="text-muted-foreground text-micro">this session</span>
            </div>
            {/* Rows bleed 2 units past the heading so the hover tint has a gutter, like a real list. */}
            <ul className="-mx-2 flex flex-col">
              {sessionRuns.slice(0, 6).map((r, i) => {
                const box = boxes.find((b) => b.name === r.box);
                // With no snapshot at all, "gone" would be a guess: the row waits, unlabelled as dead.
                const unknown = offline && boxes.length === 0;
                const gone = !live.has(r.box);
                return (
                  <li key={r.box} className="stagger-item" style={{ "--i": i + 2 } as React.CSSProperties}>
                    <button
                      type="button"
                      disabled={gone}
                      onClick={() => onOpen(r.box)}
                      onMouseEnter={() => !gone && prefetchWatch(r.box)}
                      className={cn(
                        "group flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150",
                        gone ? "cursor-default" : "hover:bg-muted cursor-pointer"
                      )}
                    >
                      {box ? (
                        <StateStamp state={displayState(box)} exitCode={box.exitCode} className="w-24 shrink-0" />
                      ) : (
                        <span className="label text-faint w-24 shrink-0">{unknown ? "unreachable" : "destroyed"}</span>
                      )}
                      <span className={cn("min-w-0 flex-1 truncate text-meta", gone ? "text-muted-foreground" : "text-foreground")}>
                        {box ? threadTitle(box) : r.task}
                      </span>
                      <span className="stamp text-muted-foreground shrink-0" title={shortName(r.box)}>
                        {friendlyName(r.box)}
                      </span>
                      {!gone && (
                        <ArrowRight className="text-muted-foreground size-3.5 shrink-0 -translate-x-0.5 opacity-0 transition-[opacity,translate] duration-150 group-hover:translate-x-0 group-hover:opacity-100" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-muted-foreground mt-3 text-micro">
              A machine's history dies with it — nothing here is stored on the server.
            </p>
          </motion.section>
        )}
      </div>
    </div>
  );
}
