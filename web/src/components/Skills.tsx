import * as React from "react";
import { ChevronDown, Plus, Sparkles, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type SkillView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * Skills: reusable playbooks the agent gets in every sandbox. Each one is a real Claude Code skill
 * (name + "when to use it" description + markdown instructions), synced into the box before every
 * run and turn. The agent reaches for one on its own when the description matches the task, and you
 * can force one from chat by starting a message with /name. Same one-column list pattern as MCP
 * servers: rows open in place into an editor.
 */

const TEMPLATE = `Steps the agent should follow, as plain markdown.

1. Look at ... first.
2. Then do ...
3. Verify by ...

Keep it specific: name the commands, files and conventions of your project.`;

export function Skills() {
  const cached = useCached("skills", (signal) => api.skills(signal));
  const skills = cached.data?.skills ?? null;
  const [open, setOpen] = React.useState<string | null>(null); // row being edited, or "__new__"

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
    <section aria-labelledby="skills-h">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="skills-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          Skills
        </h2>
        {skills && skills.length > 0 && (
          <span className="text-muted-foreground text-meta">
            {skills.length} · {onCount} on
          </span>
        )}
        <span className="text-muted-foreground text-meta">playbooks the agent can invoke — type /name in chat</span>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(open === "__new__" ? null : "__new__")}>
          <Plus />
          New skill
        </Button>
      </div>

      {cached.error && (
        <p role="alert" className="text-destructive mb-3 text-meta">
          {cached.error}
        </p>
      )}

      <div className="bg-card overflow-hidden rounded-xl border">
        <AnimatePresence initial={false}>
          {open === "__new__" && (
            <Expand key="new">
              <SkillEditor onMutate={mutate} onDone={() => setOpen(null)} />
            </Expand>
          )}
        </AnimatePresence>
        {skills === null ? (
          <ul className="divide-y">
            {[0, 1].map((i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <Bar className="size-4 rounded" />
                <Bar className="h-3 w-28" />
                <Bar className="h-2.5 w-64" />
                <Bar className="ml-auto h-5 w-9 rounded-full" />
              </li>
            ))}
          </ul>
        ) : skills.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-foreground text-body font-medium">No skills yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-meta">
              A skill is a playbook — “how we review PRs”, “how to deploy”, “our commit style” — that every sandbox
              gets. The agent uses one when it fits, or you invoke it from chat with /name.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {skills.map((s) => (
              <li key={s.name}>
                <SkillRow skill={s} open={open === s.name} onToggleOpen={() => setOpen(open === s.name ? null : s.name)} onMutate={mutate} />
                <AnimatePresence initial={false}>
                  {open === s.name && (
                    <Expand key="edit">
                      <SkillEditor initial={s} onMutate={mutate} onDone={() => setOpen(null)} />
                    </Expand>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Expand({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
      <div className="bg-muted/40 border-b px-4 py-4">{children}</div>
    </motion.div>
  );
}

function SkillRow({ skill: s, open, onToggleOpen, onMutate }: { skill: SkillView; open: boolean; onToggleOpen: () => void; onMutate: (b: Record<string, unknown>, ok?: string) => Promise<unknown> }) {
  const [busy, setBusy] = React.useState(false);
  const toggle = () => {
    setBusy(true);
    onMutate({ action: "toggle", name: s.name, enabled: !s.enabled })
      .catch((e: unknown) => toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(false));
  };
  return (
    <div className={cn("group flex items-center gap-3 px-4 py-2.5 transition-colors", open ? "bg-muted/40" : "hover:bg-muted/40")}>
      <button type="button" onClick={onToggleOpen} aria-expanded={open} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
        <Sparkles className={cn("size-4 shrink-0", s.enabled ? "text-live" : "text-muted-foreground opacity-40")} aria-hidden />
        <span className={cn("stamp shrink-0 text-body font-medium", s.enabled ? "text-foreground" : "text-muted-foreground")}>/{s.name}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-meta" title={s.description}>
          {s.description}
        </span>
        <ChevronDown className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" role="switch" aria-checked={s.enabled} disabled={busy} onClick={toggle} className={cn("relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors", s.enabled ? "bg-live" : "bg-muted-foreground/40")} aria-label={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`}>
            <span className={cn("bg-card absolute top-0.5 size-4 rounded-full shadow-e1 transition-[left]", s.enabled ? "left-[1.125rem]" : "left-0.5")} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{s.enabled ? "On — synced into every sandbox on its next turn" : "Off — kept, not given to the agent"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SkillEditor({ initial, onMutate, onDone }: { initial?: SkillView; onMutate: (b: Record<string, unknown>, ok?: string) => Promise<unknown>; onDone: () => void }) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [content, setContent] = React.useState(initial?.content ?? "");
  const [busy, setBusy] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const valid = /^[a-z0-9][a-z0-9-]{0,49}$/.test(name.trim()) && description.trim() && content.trim();

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
        initial ? "Skill saved" : `Skill /${name.trim()} added`
      );
      onDone();
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
      await onMutate({ action: "remove", name: initial!.name }, `Skill /${initial!.name} removed`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
        <label className="flex flex-col gap-1">
          <span className="label text-muted-foreground">Name — the /trigger</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
            placeholder="review-pr"
            spellCheck={false}
            className="bg-card focus:ring-ring stamp h-9 rounded-md border px-2.5 text-meta outline-none focus:ring-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-muted-foreground">When should the agent use it?</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Use when reviewing a pull request in any of our repos."
            className="bg-card focus:ring-ring h-9 rounded-md border px-2.5 text-meta outline-none focus:ring-2"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="label text-muted-foreground">Instructions (markdown)</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={TEMPLATE}
          rows={10}
          spellCheck={false}
          className="bg-card focus:ring-ring rounded-md border px-2.5 py-2 font-mono text-meta leading-relaxed outline-none focus:ring-2"
        />
      </label>
      {err && (
        <p role="alert" className="text-destructive text-meta">
          {err}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!valid || busy}>
          {busy ? "Saving…" : initial ? "Save" : "Add skill"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {initial && (
          <div className="ml-auto flex items-center gap-1.5">
            {armed && (
              <Button size="icon-sm" variant="ghost" onClick={() => setArmed(false)} aria-label="Cancel delete">
                <X />
              </Button>
            )}
            <Button size="sm" variant={armed ? "destructive" : "ghost"} onClick={remove} disabled={busy} className={cn(!armed && "text-muted-foreground")}>
              <Trash2 />
              {armed ? "Confirm delete" : "Delete"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
