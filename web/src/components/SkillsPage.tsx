import * as React from "react";
import { ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { Lightning, ChatCircleText, PencilSimpleLine } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type SkillView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo } from "@/lib/format";
import { SkillMark } from "@/lib/skillGlyph";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * Skills — a page of its own. Each skill is a card (glyph · /name · when-to-use · switch); clicking
 * one opens a right-hand editor sheet. The grid is the product: distinct glyph tints per skill make
 * the collection scannable, cards lift on hover, stagger in on mount, and reflow with layout
 * animation when one is added or removed. Creating from scratch is one click; the templates give a
 * first skill in ten seconds.
 */

type Draft = { name: string; description: string; content: string };

const TEMPLATES: (Draft & { blurb: string })[] = [
  {
    name: "review-pr",
    blurb: "A consistent PR review, your way",
    description: "Use when asked to review a pull request in any of our repos.",
    content:
      "1. Read the PR description and every changed file before commenting.\n" +
      "2. Check: correctness first, then tests, then naming and structure.\n" +
      "3. Flag anything that changes public behaviour without a test.\n" +
      "4. Summarise as: verdict (approve / needs work), then findings ordered by severity.\n" +
      "5. Be specific — file and line for every finding, no vague advice.",
  },
  {
    name: "release-notes",
    blurb: "Turn merged work into notes people read",
    description: "Use when asked to write release notes or a changelog entry.",
    content:
      "1. List the commits/PRs since the last tag.\n" +
      "2. Group into: Features, Fixes, Internal. Drop anything users cannot observe.\n" +
      "3. One line each, plain language, lead with the user benefit.\n" +
      "4. End with upgrade/migration steps only if something breaks.",
  },
  {
    name: "fix-ci",
    blurb: "Diagnose a red pipeline methodically",
    description: "Use when a CI pipeline or test run is failing and the task is to fix it.",
    content:
      "1. Reproduce locally first — run the exact failing command from the CI log.\n" +
      "2. Read the FIRST error, not the last; later failures usually cascade.\n" +
      "3. Fix the cause, not the assertion. Never skip or delete a failing test to go green.\n" +
      "4. Re-run the full suite before declaring it fixed.",
  },
];

export function SkillsPage({ onBack }: { onBack: () => void }) {
  const cached = useCached("skills", (signal) => api.skills(signal));
  const skills = cached.data?.skills ?? null;
  // The editor sheet: an existing skill, a template/new draft, or closed.
  const [editing, setEditing] = React.useState<{ initial?: SkillView; draft?: Draft } | null>(null);

  const mutate = React.useCallback(
    async (body: Record<string, unknown>, ok?: string) => {
      const r = await api.skillMutate(body);
      cached.setData(r);
      if (ok) toast.success(ok);
      return r;
    },
    [cached]
  );

  const onCount = skills?.filter((s) => s.enabled).length ?? 0;

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
          <ArrowLeft className="size-4" />
          Machines
        </Button>

        <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Skills</h1>
              {skills && skills.length > 0 && (
                <span className="text-muted-foreground text-meta">
                  {skills.length} · <span className={cn(onCount > 0 && "text-live font-medium")}>{onCount} on</span>
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-0.5 max-w-xl text-meta">
              Playbooks every sandbox gets. The agent reaches for one when it fits — or you invoke it by typing{" "}
              <span className="stamp text-foreground">/name</span> in chat.
            </p>
          </div>
          <Button onClick={() => setEditing({ draft: { name: "", description: "", content: "" } })}>
            <Plus />
            New skill
          </Button>
        </header>

        {cached.error && (
          <p role="alert" className="text-destructive mb-4 text-meta">
            {cached.error}
          </p>
        )}

        {skills === null ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-card rounded-xl border p-4">
                <div className="flex items-start justify-between">
                  <Bar className="size-11 rounded-lg" />
                  <Bar className="h-5 w-9 rounded-full" />
                </div>
                <Bar className="mt-3.5 h-3.5 w-28" />
                <Bar className="mt-2.5 h-3 w-full" />
                <Bar className="mt-1.5 h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : skills.length === 0 ? (
          <EmptyState onPick={(d) => setEditing({ draft: d })} onNew={() => setEditing({ draft: { name: "", description: "", content: "" } })} />
        ) : (
          <motion.ul layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {skills.map((s, i) => (
                <SkillCard key={s.name} skill={s} index={i} onOpen={() => setEditing({ initial: s })} onMutate={mutate} />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <EditorSheet
            key="sheet"
            initial={editing.initial}
            draft={editing.draft}
            onMutate={mutate}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────────── cards ───────────────────────────── */

function SkillCard({
  skill: s,
  index,
  onOpen,
  onMutate,
}: {
  skill: SkillView;
  index: number;
  onOpen: () => void;
  onMutate: (b: Record<string, unknown>, ok?: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = React.useState(false);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    onMutate({ action: "toggle", name: s.name, enabled: !s.enabled })
      .catch((err: unknown) => toast.error("Could not update", { description: err instanceof Error ? err.message : String(err) }))
      .finally(() => setBusy(false));
  };
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index * 0.04, 0.3), duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      className="min-w-0"
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group bg-card block w-full cursor-pointer rounded-xl border p-4 text-left",
          "transition-[transform,box-shadow,border-color] duration-200 ease-out",
          "hover:border-line-strong hover:-translate-y-0.5 hover:shadow-e2",
          "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
          !s.enabled && "opacity-60 hover:opacity-90"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <SkillMark name={s.name} size="lg" className="transition-transform duration-200 group-hover:scale-105" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="switch"
                aria-checked={s.enabled}
                tabIndex={0}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") toggle(e as unknown as React.MouseEvent);
                }}
                className={cn(
                  "relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors",
                  busy && "opacity-60",
                  s.enabled ? "bg-live" : "bg-muted-foreground/40"
                )}
                aria-label={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`}
              >
                <span className={cn("bg-card absolute top-0.5 size-4 rounded-full shadow-e1 transition-[left] duration-200", s.enabled ? "left-[1.125rem]" : "left-0.5")} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{s.enabled ? "On — synced into every sandbox on its next turn" : "Off — kept, not given to the agent"}</TooltipContent>
          </Tooltip>
        </div>

        <p className="stamp text-foreground mt-3 truncate text-body font-semibold">/{s.name}</p>
        <p className="text-muted-foreground mt-1 line-clamp-2 min-h-[2.4em] text-meta leading-snug">{s.description}</p>

        <div className="text-faint mt-3 flex items-center gap-2 text-micro">
          <span>updated {fmtAgo(Math.floor(s.updatedAt / 1000))}</span>
          <span className="text-live ml-auto inline-flex translate-x-1 items-center gap-1 font-medium opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100">
            <PencilSimpleLine size={12} weight="bold" aria-hidden />
            Edit
          </span>
        </div>
      </button>
    </motion.li>
  );
}

/* ───────────────────────────── empty state ───────────────────────────── */

function EmptyState({ onPick, onNew }: { onPick: (d: Draft) => void; onNew: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-12">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto flex w-fit -space-x-2">
          {TEMPLATES.map((t, i) => (
            <motion.span
              key={t.name}
              initial={{ opacity: 0, y: 8, rotate: 0 }}
              animate={{ opacity: 1, y: 0, rotate: (i - 1) * 8 }}
              transition={{ delay: 0.08 * i, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="bg-card inline-block rounded-xl border p-2 shadow-e1"
            >
              <SkillMark name={t.name} size="md" />
            </motion.span>
          ))}
        </div>
        <h2 className="text-foreground mt-5 text-h3 font-semibold">Teach the agent how you work</h2>
        <p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-meta leading-relaxed">
          A skill is a playbook — how you review PRs, cut a release, fix CI. Write it once and every sandbox follows
          it: the agent picks it up when it fits, or you call it with <span className="stamp text-foreground">/name</span> in chat.
        </p>
      </div>

      <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
        {TEMPLATES.map((t, i) => (
          <motion.button
            key={t.name}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.06, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => onPick({ name: t.name, description: t.description, content: t.content })}
            className="group bg-card cursor-pointer rounded-xl border p-4 text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-e2"
          >
            <SkillMark name={t.name} size="md" className="transition-transform duration-200 group-hover:scale-105" />
            <p className="stamp text-foreground mt-2.5 text-meta font-semibold">/{t.name}</p>
            <p className="text-muted-foreground mt-1 text-micro leading-snug">{t.blurb}</p>
            <p className="text-live mt-2 text-micro font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100">Start from this →</p>
          </motion.button>
        ))}
      </div>

      <p className="text-muted-foreground mt-6 text-center text-meta">
        or{" "}
        <button type="button" onClick={onNew} className="text-live cursor-pointer font-medium hover:underline">
          write one from scratch
        </button>
      </p>
    </div>
  );
}

/* ───────────────────────────── editor sheet ───────────────────────────── */

function EditorSheet({
  initial,
  draft,
  onMutate,
  onClose,
}: {
  initial?: SkillView;
  draft?: Draft;
  onMutate: (b: Record<string, unknown>, ok?: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? draft?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? draft?.description ?? "");
  const [content, setContent] = React.useState(initial?.content ?? draft?.content ?? "");
  const [busy, setBusy] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const valid = /^[a-z0-9][a-z0-9-]{0,49}$/.test(name.trim()) && description.trim() && content.trim();

  React.useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onMutate(
        {
          action: "upsert",
          previousName: initial?.name,
          skill: { name: name.trim(), description: description.trim(), content, enabled: initial?.enabled ?? true },
        },
        initial ? "Skill saved" : `/${name.trim()} is live — every sandbox gets it on its next turn`
      );
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!armed) return setArmed(true);
    setBusy(true);
    try {
      await onMutate({ action: "remove", name: initial!.name }, `/${initial!.name} removed`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={initial ? `Edit skill ${initial.name}` : "New skill"}>
      <motion.button
        type="button"
        aria-label="Close"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]"
      />
      <motion.div
        initial={{ x: "104%" }}
        animate={{ x: 0 }}
        exit={{ x: "104%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        className="bg-card absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l shadow-e5 sm:inset-y-2 sm:right-2 sm:rounded-2xl sm:border"
      >
        <header className="flex items-center gap-3 border-b px-5 py-4">
          <SkillMark name={name || "skill"} size="md" />
          <div className="min-w-0 flex-1">
            <h2 className="text-foreground truncate text-body font-semibold">{initial ? <span className="stamp">/{initial.name}</span> : "New skill"}</h2>
            <p className="text-muted-foreground text-micro">{initial ? "Changes reach every sandbox on its next turn" : "A playbook the agent can follow"}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
            <label className="flex flex-col gap-1.5">
              <span className="label text-muted-foreground">Name · the /trigger</span>
              <div className="focus-within:ring-ring bg-background flex h-9 items-center rounded-md border transition-shadow focus-within:ring-2">
                <span className="text-muted-foreground stamp pl-2.5">/</span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                  placeholder="review-pr"
                  spellCheck={false}
                  className="stamp text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent pr-2.5 pl-0.5 text-meta outline-none"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label text-muted-foreground">When should the agent use it?</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Use when reviewing a pull request in any of our repos."
                className="bg-background focus:ring-ring h-9 rounded-md border px-2.5 text-meta outline-none transition-shadow focus:ring-2"
              />
            </label>
          </div>

          <label className="flex min-h-0 flex-1 flex-col gap-1.5">
            <span className="label text-muted-foreground flex items-baseline justify-between">
              Instructions · markdown
              <span className={cn("tabular font-normal normal-case", content.length > 60_000 ? "text-destructive" : "text-faint")}>{content.length.toLocaleString()} / 65,536</span>
            </span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={"Steps the agent should follow, as plain markdown.\n\n1. Look at … first.\n2. Then do …\n3. Verify by …\n\nBe specific: name the commands, files and conventions of your project."}
              spellCheck={false}
              className="bg-background focus:ring-ring min-h-[16rem] flex-1 resize-none rounded-md border px-3 py-2.5 font-mono text-meta leading-relaxed outline-none transition-shadow focus:ring-2"
            />
          </label>

          <div className="bg-muted/50 flex items-start gap-2.5 rounded-lg px-3 py-2.5">
            <ChatCircleText size={16} weight="duotone" className="text-live mt-0.5 shrink-0" aria-hidden />
            <p className="text-muted-foreground text-micro leading-relaxed">
              In chat, type <span className="stamp text-foreground">/</span> to pick a skill — it becomes a tag on your
              message. The agent also uses skills on its own when the “when to use it” line matches the task.
            </p>
          </div>

          {err && (
            <p role="alert" className="text-destructive text-meta">
              {err}
            </p>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t px-5 py-3.5">
          {initial && (
            <>
              <Button size="sm" variant={armed ? "destructive" : "ghost"} onClick={remove} disabled={busy} className={cn(!armed && "text-muted-foreground")}>
                <Trash2 />
                {armed ? "Confirm delete" : "Delete"}
              </Button>
              {armed && (
                <Button size="icon-sm" variant="ghost" onClick={() => setArmed(false)} aria-label="Cancel delete">
                  <X />
                </Button>
              )}
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={!valid || busy}>
              <Lightning size={14} weight="fill" aria-hidden />
              {busy ? "Saving…" : initial ? "Save changes" : "Create skill"}
            </Button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}
