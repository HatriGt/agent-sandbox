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
  Layers,
  Loader2,
  ImagePlus,
  Lock,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { RepoPicker, type PickedRepo } from "@/components/RepoPicker";
import { ModelChip, useModelChoice } from "@/components/thread/ModelPicker";
import { motion } from "motion/react";
import { api, type BoxView, type FleetLifecycle } from "@/lib/api";
import { fmtAgo, friendlyName, shortName, threadSort, threadTitle } from "@/lib/format";
import { readDraft, takePrefill, writeDraft } from "@/lib/draft";
import { getMe } from "@/lib/auth";
import { GettingStarted } from "@/components/GettingStarted";
import { TrialEndedNotice } from "@/components/TrialBadge";
import { displayState, fmtDuration } from "@/lib/lifecycle";
import { questionHeadline } from "@/lib/question";
import { prefetchWatch } from "@/hooks/useWatchStream";
import { Button } from "@/components/ui/button";
import { StateStamp } from "@/components/ui/stamp";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { Lightbox } from "@/components/ui/lightbox";
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

interface Starter {
  icon: React.ReactNode;
  label: string;
  task: string;
  needsRepo?: boolean;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const STARTERS: Starter[] = [
  {
    icon: <FileSearch />,
    label: "Explain a codebase",
    task: "Read this repository and write a concise architecture overview: the entry points, the main modules and how they depend on each other, and anything surprising. Do not change any files.",
    needsRepo: true,
  },
  {
    icon: <Bug />,
    label: "Fix a bug, open a PR",
    task: "Find and fix the following bug, add a regression test, and open a pull request:\n\n",
    needsRepo: true,
  },
  {
    icon: <FlaskConical />,
    label: "Run the tests",
    task: "Install dependencies, run the full test suite, and report exactly what fails with the command and the key error lines. Do not fix anything yet — stop and tell me what you found.",
    needsRepo: true,
  },
  {
    icon: <ClipboardCheck />,
    label: "Review a diff",
    task: "Review the changes on the current branch against main. Report correctness bugs first, then anything that could be simpler. Do not change files.",
    needsRepo: true,
  },
  {
    icon: <Layers />,
    label: "Research, no repo",
    task: "Write a thorough, well-sourced report on the following, into /workspace/report.md:\n\n",
  },
];

/** One honest sentence about the fleet right now, built only from live data. */
function fleetLine(boxes: BoxView[], lc: FleetLifecycle): string {
  const waiting = boxes.filter((b) => b.runState === "waiting").length;
  const working = boxes.filter((b) => b.runState === "running" && displayState(b) === "running").length;
  const warm = boxes.filter((b) => b.role === "pool-free" && displayState(b) === "idle").length;
  const up = boxes.filter((b) => displayState(b) !== "sleeping").length;
  const parts: string[] = [];
  if (waiting) parts.push(`${waiting} ${waiting === 1 ? "machine needs" : "machines need"} your answer`);
  if (working) parts.push(`${working} working`);
  const full = lc.capacity > 0 && up >= lc.capacity;
  const tail = full
    ? `All ${lc.capacity} slots are in use — finish or destroy a machine to start another.`
    : warm
      ? "A warm machine is ready, so a new task starts in seconds."
      : "No warm machine right now — a fresh microVM boots in a few seconds.";
  return parts.length ? `${parts.join(", ")}. ${tail}` : tail;
}

export function Hub({
  boxes,
  lifecycle,
  loading,
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
  sessionRuns: SessionRun[];
  onBooting: (task: string) => void;
  onStarted: (box: string, task: string) => void;
  onFailed: () => void;
  onPending: (p: { id: string; task: string }) => void;
  onSettled: (id: string) => void;
  onOpen: (name: string) => void;
  onBack: () => void;
}) {
  // A handoff from a finished run wins; otherwise whatever was typed before a reload or detour.
  const prefill = React.useRef(takePrefill());
  const [task, setTask] = React.useState(() => prefill.current?.task ?? readDraft("hub"));
  const [picked, setPicked] = React.useState<PickedRepo[]>([]);
  // Model for message 1 — the "new-task" scope key keeps it distinct from any box's sticky pick.
  const model = useModelChoice("new-task");
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
  const [error, setError] = React.useState<string | null>(null);

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
    setTask(s.task);
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
  const [images, setImages] = React.useState<{ id: string; name: string; dataUrl: string }[]>([]);
  const [preview, setPreview] = React.useState<{ name: string; dataUrl: string } | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const addImages = (list: Iterable<File>) => {
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
        setImages((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: `${stem}.${ext}`, dataUrl: String(reader.result) }]);
      };
      reader.readAsDataURL(f);
    }
  };

  const submit = async () => {
    const t = task.trim();
    if ((!t && !images.length) || busy) return;
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
        ...(model.picked ? { model: model.picked } : {}),
      });
      if (res.ok) {
        // Accepted: only now let go of the brief and the images (the draft effect clears storage too).
        setTask("");
        setImages([]);
        if (res.inferred?.length) {
          toast("Attached from the task", {
            description: `${res.inferred.join(", ")} — named in your task, so it was checked out for the agent.`,
            icon: <GitBranch className="size-4" />,
          });
        }
        onStarted(res.box, t);
      } else {
        onFailed();
        setError(res.question);
        // The Hub may have been swapped out for the booting pane: the toast survives, the draft is still in storage.
        toast.error("Could not start the task", { description: res.question });
      }
    } catch (e) {
      onFailed();
      const msg = e instanceof Error ? e.message : String(e);
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

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-16 md:px-6 md:pt-[8vh]">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
            <ArrowLeft className="size-4" />
            Machines
          </Button>
          <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em] text-balance">
            {greeting()}
          </h1>
          {loading ? (
            <div className="mt-3 flex flex-col gap-2">
              <Bar className="h-3 w-[70%]" />
              <Bar className="h-3 w-[40%]" />
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 max-w-[56ch] text-body">{fleetLine(boxes, lifecycle)}</p>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}>
          <TrialEndedNotice />
          <div className="relative">
          <VoicePill state={voice.state} interim={voice.interim} />
          <PromptInput
            value={task}
            onValueChange={setTask}
            onSubmit={getMe()?.kind === "user" && getMe()?.kind === "user" && (getMe() as { expired?: boolean }).expired ? () => {} : submit}
            isLoading={busy}
            className={cn(
              "bg-card border-line-strong focus-within:border-live/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--live)_18%,transparent)] rounded-xl p-2 shadow-e1 transition-[border-color,box-shadow] duration-200",
              dragOver && "border-live ring-live/40 ring-2",
              (voice.state === "listening" || voice.state === "arming") && "mic-glow"
            )}
            onPaste={(e) => {
              const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
              if (files.length) {
                e.preventDefault();
                addImages(files);
              }
            }}
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
            <label htmlFor="new-task" className="sr-only">
              Describe the task for a new machine
            </label>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 px-2 pt-1.5" onClick={(e) => e.stopPropagation()}>
                {images.map((img) => (
                  <span key={img.id} className="enter group relative block size-16 overflow-hidden rounded-md border" title={img.name}>
                    <button type="button" onClick={() => setPreview(img)} aria-label={`Preview ${img.name}`} className="block size-full cursor-zoom-in">
                      <img src={img.dataUrl} alt={img.name} className="size-full object-cover transition-transform duration-200 group-hover:scale-105" />
                    </button>
                    <button type="button" onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))} aria-label={`Remove ${img.name}`} className="bg-card/80 text-foreground hover:bg-card absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full opacity-0 shadow-e1 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <PromptInputTextarea
              id="new-task"
              placeholder="Describe a task. A fresh microVM picks it up…"
              className="min-h-14 px-2.5 pt-2 text-body"
            />

            {picked.length > 0 && (
              <div className="enter mt-1 flex flex-wrap gap-1.5 px-1" onClick={(e) => e.stopPropagation()}>
                {picked.map((p) => (
                  <span key={p.repo} className="bg-muted text-foreground inline-flex h-7 items-center gap-1.5 rounded-md pl-2 pr-1 font-mono text-micro">
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

            <PromptInputActions className="relative justify-between pt-1">
              <div ref={pickerRef} className="relative" onClick={(e) => e.stopPropagation()}>
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
                  {picked.length ? "Add another repo" : "Attach repos"}
                </button>
                <ModelChip current={model.current} models={model.models} defaultId={model.defaultId} onPick={model.pick} />
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
              <p className={cn("hidden min-w-0 flex-1 truncate text-right text-micro sm:block", error ? "text-destructive" : "text-muted-foreground")}>
                {error ??
                  (lifecycle.maxDurationSec
                    ? `Enter starts the machine · runs up to ${fmtDuration(lifecycle.maxDurationSec)}${lifecycle.idleTimeoutSec ? `, sleeps after ${fmtDuration(lifecycle.idleTimeoutSec)} quiet` : ""}`
                    : "Enter starts the machine · a repo named in the task is attached automatically")}
              </p>
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
          </div>
          <Lightbox src={preview?.dataUrl ?? null} name={preview?.name ?? ""} open={!!preview} onClose={() => setPreview(null)} />
          {error && (
            <p className="text-destructive mt-2 px-1 text-micro sm:hidden" role="alert">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => applyStarter(s)}
                className="text-muted-foreground hover:text-foreground hover:bg-muted flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-meta transition-colors [&_svg]:size-3.5 [&_svg]:text-faint hover:[&_svg]:text-muted-foreground"
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>
        </motion.div>

        {!loading && runs.length === 0 && getMe()?.kind === "user" && <GettingStarted />}
        {!loading && runs.length === 0 && (
          <motion.section
            aria-label="No runs yet"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center px-6 py-10 text-center"
          >
            <span className="bg-muted text-muted-foreground mb-4 grid size-12 place-items-center rounded-full" aria-hidden>
              <Layers className="size-5" />
            </span>
            <p className="text-foreground text-lead font-medium">Nothing running</p>
            <p className="text-muted-foreground mt-1 max-w-[28em] text-meta leading-relaxed">Pick a repository, describe the task, and it will appear here while it runs.</p>
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
            <ul className="divide-y rounded-xl border">
              {loading
                ? [0, 1, 2].map((i) => (
                    <li key={i} className="flex items-center gap-3 px-3.5 py-3">
                      <Bar className="h-2.5 w-20" />
                      <Bar className="h-3 flex-1" />
                      <Bar className="h-2.5 w-16" />
                    </li>
                  ))
                : runs.map((b) => (
                    <li key={b.name}>
                      <button
                        type="button"
                        onClick={() => onOpen(b.name)}
                        onMouseEnter={() => prefetchWatch(b.name)}
                        className="group hover:bg-muted flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors first:rounded-t-xl last:rounded-b-xl"
                      >
                        <StateStamp state={displayState(b)} exitCode={b.exitCode} className="w-24 shrink-0" />
                        <span className="text-foreground min-w-0 flex-1 truncate text-meta">
                          {b.runState === "waiting" && b.question ? questionHeadline(b.question) : threadTitle(b)}
                        </span>
                        {b.lastOutputAt && (
                          <span className="text-faint hidden shrink-0 text-micro sm:inline">
                            {b.runState === "running" ? "active " : ""}
                            {fmtAgo(b.lastOutputAt)}
                          </span>
                        )}
                        <span className="stamp text-muted-foreground shrink-0" title={shortName(b.name)}>
                          {friendlyName(b.name)}
                        </span>
                        <ArrowRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </li>
                  ))}
            </ul>
          </motion.section>
        )}

        {sessionRuns.length > 0 && (
          <section aria-labelledby="started-here">
            <div className="flex items-baseline justify-between pb-2">
              <h2 id="started-here" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
                Started from this browser
              </h2>
              <span className="text-muted-foreground text-micro">this session</span>
            </div>
            <ul className="flex flex-col">
              {sessionRuns.slice(0, 6).map((r) => {
                const box = boxes.find((b) => b.name === r.box);
                const gone = !live.has(r.box);
                return (
                  <li key={r.box}>
                    <button
                      type="button"
                      disabled={gone}
                      onClick={() => onOpen(r.box)}
                      className={cn(
                        "group flex w-full items-center gap-3 border-b py-2.5 text-left last:border-b-0",
                        gone ? "cursor-default" : "cursor-pointer"
                      )}
                    >
                      {box ? (
                        <StateStamp state={displayState(box)} exitCode={box.exitCode} className="w-24 shrink-0" />
                      ) : (
                        <span className="label text-faint w-24 shrink-0">destroyed</span>
                      )}
                      <span className={cn("min-w-0 flex-1 truncate text-meta", gone ? "text-muted-foreground" : "text-foreground")}>
                        {box ? threadTitle(box) : r.task}
                      </span>
                      <span className="stamp text-muted-foreground shrink-0" title={shortName(r.box)}>
                        {friendlyName(r.box)}
                      </span>
                      {!gone && (
                        <ArrowRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-muted-foreground mt-3 text-micro">
              A machine's history dies with it — nothing here is stored on the server.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
