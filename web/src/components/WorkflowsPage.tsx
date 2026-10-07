import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Github, ListChecks, Pencil, Plus, ShieldAlert, Terminal, Trash2, Wand2, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, type Automation, type WorkflowStep, type WorkflowView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Panel, PanelFooter, SettingsSection } from "@/components/ui/settings";
import { EmptyState } from "@/components/ui/empty-state";
import { Swap } from "@/components/ui/swap";
import { Bar } from "@/components/thread/Skeletons";
import { DataTable, stopRow, type Column } from "@/components/ui/data-table";

const EXAMPLE = `name: ship-feature
description: implement, prove it with tests, then review your own diff
steps:
  - title: Implement
    prompt: |
      {{task}}
      Write tests alongside the code.
  - command: npm test
    retry: 2
    feedback: Never weaken or delete a test to make it pass.
  - title: Review
    prompt: Review the full diff as a strict reviewer and fix anything you would reject.
  - command: npm run lint
`;

const STARTERS: { name: string; line: string; yaml: string }[] = [
  { name: "Ship a feature", line: "Implement → test → self-review → lint", yaml: EXAMPLE },
  {
    name: "Fix a bug",
    line: "Reproduce with a failing test first, then fix until it passes",
    yaml: `name: fix-bug
description: reproduce with a failing test, then fix
steps:
  - title: Reproduce
    prompt: |
      {{task}}
      Before changing any code, add a test that fails because of this bug. Stop there.
  - title: Fix
    prompt: Now fix the bug so the new test passes. Keep the change minimal.
  - command: npm test
    retry: 3
    feedback: Fix the code, not the test.
`,
  },
  {
    name: "Keep CI green",
    line: "Make the change, then typecheck and test with retries",
    yaml: `name: ci-green
description: change, then typecheck and test until green
steps:
  - prompt: "{{task}}"
  - command: npx tsc --noEmit
    retry: 2
  - command: npm test
    retry: 2
`,
  },
  {
    name: "Plan, then build",
    line: "Write a plan to PLAN.md, then implement it step by step",
    yaml: `name: plan-then-build
description: write a plan first, then follow it
steps:
  - title: Plan
    prompt: |
      {{task}}
      Do not write code yet. Write a short step-by-step plan to PLAN.md.
  - command: test -s PLAN.md
  - title: Build
    prompt: Implement PLAN.md step by step, then delete PLAN.md.
`,
  },
];

/**
 * Workflows: a task as a short script — agent turns and command checks — saved per user or read from
 * a repository's .agent-sandbox/workflows/ folder. The editor is the YAML itself (the same file a
 * repo would hold), validated by the controller as you type, with the parsed steps shown beside it
 * so a prompt can never be mistaken for a command.
 */
export function WorkflowsPage({ onAutomate }: { onAutomate: (w: WorkflowView) => void }) {
  const [list, setList] = React.useState<WorkflowView[] | null>(null);
  const [dir, setDir] = React.useState(".agent-sandbox/workflows");
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id?: string; yaml: string } | null>(null);
  const [importing, setImporting] = React.useState(false);

  const reload = React.useCallback(() => {
    api
      .workflows()
      .then((r) => {
        setList(r.workflows);
        setDir(r.dir);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  React.useEffect(reload, [reload]);

  const mutate = async (body: Record<string, unknown>, ok?: string) => {
    try {
      const r = await api.workflowMutate(body);
      setList(r.workflows);
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    }
  };

  const edit = async (w: WorkflowView) => {
    try {
      const r = await api.workflowYaml(w.id);
      setEditing({ id: w.id, yaml: r.yaml });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const items = list ?? [];
  // Which automations run each playbook — the link between "how" and "when".
  const triggers = useCached("triggers", (signal) => api.triggers(signal)).data?.triggers ?? [];
  const usedBy = (id: string) => triggers.filter((t) => t.workflowId === id);
  return (
    <div className="min-w-0">
      <div>
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-meta">
            <span className="text-foreground">How</span> a task gets done: agent turns and command checks, in order. Failed checks go back to the agent. Use one from the composer, or let an automation run it.
          </p>
          <AnimatePresence initial={false}>
            {!editing && !importing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                className="flex shrink-0 flex-wrap items-center gap-2"
              >
                <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                  <Github className="size-4" />
                  From a repo
                </Button>
                <Button size="sm" onClick={() => setEditing({ yaml: EXAMPLE })}>
                  <Plus className="size-4" />
                  New playbook
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </header>
        <Swap state={editing ? "editor" : importing ? "import" : "list"} className="flex flex-col gap-10">
          {editing ? (
            <WorkflowEditor
              initial={editing.yaml}
              isNew={!editing.id}
              onCancel={() => setEditing(null)}
              onSave={async (yaml) => {
                const r = await mutate({ action: "upsert", ...(editing.id ? { id: editing.id } : {}), yaml }, editing.id ? "Playbook saved" : "Playbook created");
                if (r) setEditing(null);
              }}
            />
          ) : importing ? (
            <ImportFromRepo
              dir={dir}
              onCancel={() => setImporting(false)}
              onDone={(r) => {
                setList(r.workflows);
                setImporting(false);
              }}
            />
          ) : (
            <>
              <SettingsSection id="saved" title="Saved playbooks" meta={list ? items.length : undefined} purpose="Pick one in the composer, or automate it; your task fills {{task}} in its first step.">
                {error ? (
                  <EmptyState icon={ShieldAlert} tone="destructive" title="Couldn't load playbooks" line={error} action={<Button variant="outline" size="sm" onClick={reload}>Retry</Button>} />
                ) : !list ? (
                  <Panel className="divide-y">
                    {[0, 1].map((i) => (
                      <div key={i} className="h-[4.25rem] px-4 py-3">
                        <Bar className="h-3.5 w-40" />
                        <Bar className="mt-2 h-3 w-64" />
                      </div>
                    ))}
                  </Panel>
                ) : !items.length ? (
                  <EmptyState
                    icon={ListChecks}
                    title="No playbooks yet"
                    line="Implement → test → review, with the test failure handed back to the agent. Write one here, start from a template below, or keep them in your repo."
                    action={
                      <>
                        <Button size="sm" onClick={() => setEditing({ yaml: EXAMPLE })}>
                          <Plus className="size-4" />
                          New playbook
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                          <Github className="size-4" />
                          From a repo
                        </Button>
                      </>
                    }
                  />
                ) : (
                  <PlaybookTable items={items} usedBy={usedBy} onEdit={(w) => void edit(w)} onDelete={(w) => void mutate({ action: "delete", id: w.id }, "Deleted")} onAutomate={onAutomate} />
                )}
              </SettingsSection>
              <SettingsSection id="starters" title="Start from a template" purpose="Opens in the editor — change anything before you save.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {STARTERS.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => setEditing({ yaml: t.yaml })}
                      className="bg-card hover:bg-muted/50 focus-visible:ring-live/50 rounded-lg border px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2"
                    >
                      <span className="text-foreground block text-meta font-medium">{t.name}</span>
                      <span className="text-muted-foreground block text-micro">{t.line}</span>
                    </button>
                  ))}
                </div>
              </SettingsSection>
              <Panel className="text-muted-foreground px-4 py-3 text-micro">
                Every step runs in the <span className="text-foreground">same sandbox</span>: a prompt step is one more turn of the same agent (it keeps its context and can still stop to ask you), and a command step runs after the previous
                turn finishes — exit 0 moves on, anything else goes back to the agent with the output, up to <span className="font-mono">retry</span> times. A repository can keep its own in{" "}
                <span className="text-foreground font-mono">{dir}/*.yaml</span>; a harness still sets the driver, model and rules.
              </Panel>
            </>
          )}
        </Swap>
      </div>
    </div>
  );
}

function stepLine(s: WorkflowStep): string {
  if (s.kind === "check") return `$ ${s.command}${s.retry ? ` (retry ×${s.retry})` : ""}`;
  return s.title ?? (s.skill ? `/${s.skill}` : s.prompt.replace(/\s+/g, " ").slice(0, 60));
}

/** Saved playbooks as a table: what it is, its steps, which automations run it, where it lives. The row opens the editor. */
function PlaybookTable({
  items,
  usedBy,
  onEdit,
  onDelete,
  onAutomate,
}: {
  items: WorkflowView[];
  usedBy: (id: string) => Automation[];
  onEdit: (w: WorkflowView) => void;
  onDelete: (w: WorkflowView) => void;
  onAutomate: (w: WorkflowView) => void;
}) {
  const columns: Column<WorkflowView>[] = [
    {
      id: "name",
      header: "Playbook",
      sort: (w) => w.name,
      cell: (w) => (
        <>
          <span className="text-foreground block truncate font-medium" title={w.name}>
            {w.name}
          </span>
          <span className="text-muted-foreground block truncate text-micro" title={w.description}>
            {w.description || `updated ${fmtAgo(w.updatedAt)}`}
          </span>
        </>
      ),
    },
    {
      id: "steps",
      header: "Steps",
      width: "w-[34%]",
      sort: (w) => w.steps.length,
      cell: (w) => {
        const checks = w.steps.filter((s) => s.kind === "check").length;
        return (
          <>
            <span className="text-muted-foreground flex min-w-0 items-center gap-1 truncate text-micro" title={w.steps.map(stepLine).join(" → ")}>
              {w.steps.slice(0, 4).map((s, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="text-faint" aria-hidden>→</span>}
                  {s.kind === "check" ? <Terminal className="size-3 shrink-0" aria-label="check" /> : <Wand2 className="size-3 shrink-0" aria-label="agent turn" />}
                </React.Fragment>
              ))}
              {w.steps.length > 4 && <span className="text-faint">+{w.steps.length - 4}</span>}
            </span>
            <span className="text-faint block truncate text-micro tabular-nums">
              {w.steps.length} step{w.steps.length === 1 ? "" : "s"} · {checks} check{checks === 1 ? "" : "s"}
            </span>
          </>
        );
      },
    },
    {
      id: "used",
      header: "Automated by",
      width: "w-[8.5rem]",
      sort: (w) => usedBy(w.id).length,
      cell: (w) => {
        const used = usedBy(w.id);
        return used.length ? (
          <span className="text-foreground block truncate text-micro" title={used.map((t) => `${t.name} — ${t.when}`).join("\n")}>
            {used.length === 1 ? used[0].name : `${used.length} automations`}
          </span>
        ) : (
          <span className="text-faint text-micro">Manual only</span>
        );
      },
    },
    {
      id: "source",
      header: "Source",
      width: "w-[7rem]",
      sort: (w) => (w.origin?.kind === "repo" ? w.origin.repo : ""),
      cell: (w) =>
        w.origin?.kind === "repo" ? (
          <span className="text-muted-foreground block truncate font-mono text-micro" title={`${w.origin.repo} · ${w.origin.path}`}>
            {w.origin.repo}
          </span>
        ) : (
          <span className="text-muted-foreground text-micro">Saved here</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "w-[9.5rem]",
      align: "end",
      cell: (w) => <PlaybookActions w={w} onEdit={() => onEdit(w)} onDelete={() => onDelete(w)} onAutomate={() => onAutomate(w)} />,
    },
  ];
  return <DataTable aria-label="Saved playbooks" rows={items} columns={columns} rowKey={(w) => w.id} onRowClick={onEdit} rowLabel={(w) => `Edit ${w.name}`} minWidth="min-w-[40rem]" />;
}

function PlaybookActions({ w, onEdit, onDelete, onAutomate }: { w: WorkflowView; onEdit: () => void; onDelete: () => void; onAutomate: () => void }) {
  const [armed, setArmed] = React.useState(false);
  return (
    <span className="inline-flex items-center gap-0.5" onClick={stopRow} onKeyDown={stopRow}>
      <Button variant="ghost" size="xs" onClick={onAutomate} title="Run this playbook on a schedule or event">
        <Zap />
        Automate
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label={`Edit ${w.name}`} title="Edit">
        <Pencil />
      </Button>
      <Button
        variant={armed ? "destructive" : "ghost"}
        size={armed ? "xs" : "icon-xs"}
        onClick={() => (armed ? onDelete() : setArmed(true))}
        onBlur={() => setArmed(false)}
        aria-label={`Delete ${w.name}`}
        title="Delete"
      >
        {armed ? "Delete" : <Trash2 />}
      </Button>
    </span>
  );
}

/** The YAML is the form. The controller parses it as you type; the parsed steps are shown beside it. */
function WorkflowEditor({ initial, isNew, onCancel, onSave }: { initial: string; isNew: boolean; onCancel: () => void; onSave: (yaml: string) => Promise<void> }) {
  const [yaml, setYaml] = React.useState(initial);
  const [preview, setPreview] = React.useState<WorkflowView | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => {
      api
        .workflowPreview(yaml)
        .then((r) => {
          setPreview(r.workflow);
          setProblem(null);
        })
        .catch((e: Error) => {
          setPreview(null);
          setProblem(e.message);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [yaml]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      toast.success("Copied — drop it in .agent-sandbox/workflows/ to keep it with the repo");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <Panel>
      <div className="grid gap-4 p-4 md:grid-cols-[3fr_2fr]">
        <Field label={isNew ? "New workflow" : "Workflow"} error={problem ?? undefined} ok={preview ? `${preview.steps.length} steps` : undefined} hint="YAML — the same text a repo file holds.">
          {(wire) => (
            <textarea
              {...wire}
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              spellCheck={false}
              rows={Math.min(32, Math.max(12, yaml.split("\n").length + 1))}
              className="border-line-strong bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 aria-invalid:border-destructive/60 w-full rounded-md border px-3 py-2 font-mono text-micro leading-relaxed outline-none focus-visible:ring-2"
            />
          )}
        </Field>
        <div className="min-w-0">
          <span className="label text-muted-foreground">What will run</span>
          {preview ? (
            <ol className="mt-2 flex flex-col gap-2">
              {preview.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="text-faint w-4 shrink-0 text-right font-mono text-micro tabular-nums">{i + 1}</span>
                  {s.kind === "check" ? <Terminal className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden /> : <Wand2 className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />}
                  <div className="min-w-0">
                    {s.kind === "check" ? (
                      <>
                        <span className="text-foreground font-mono text-micro">{s.command}</span>
                        <p className="text-muted-foreground text-micro">
                          exit 0 continues{s.retry ? `; a failure goes back to the agent up to ${s.retry} time${s.retry === 1 ? "" : "s"}` : "; a failure ends the workflow"}
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="text-foreground text-micro font-medium">{s.title ?? `Agent turn${s.skill ? ` · /${s.skill}` : ""}`}</span>
                        <p className="text-muted-foreground line-clamp-3 text-micro whitespace-pre-wrap">{s.prompt}</p>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-faint mt-2 text-micro">{problem ? "Fix the YAML to see the steps." : "Parsing…"}</p>
          )}
        </div>
      </div>
      <PanelFooter>
        <Button variant="ghost" size="sm" onClick={copy}>
          <Copy className="size-4" />
          Copy YAML
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!preview || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(yaml);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check className="size-4" />
          {isNew ? "Create" : "Save"}
        </Button>
      </PanelFooter>
    </Panel>
  );
}

/** Read every `*.yaml` under the repo's workflow folder (through the controller: the page's CSP is connect-src 'self'). */
function ImportFromRepo({ dir, onCancel, onDone }: { dir: string; onCancel: () => void; onDone: (r: Awaited<ReturnType<typeof api.workflowMutate>>) => void }) {
  const [repo, setRepo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async () => {
    const s = repo.trim().replace(/^https?:\/\/github\.com\//, "");
    const m = s.match(/^([\w.-]+\/[\w.-]+?)(?:\.git)?(?:@(.+))?$/);
    if (!m) return setError("Enter a repository as owner/repo (optionally @branch).");
    setBusy(true);
    setError(null);
    try {
      const r = await api.workflowMutate({ action: "import-repo", repo: m[1], ...(m[2] ? { ref: m[2] } : {}) });
      const n = r.imported?.length ?? 0;
      toast.success(n ? `Imported ${n} workflow${n === 1 ? "" : "s"} from ${m[1]}` : `Nothing imported from ${m[1]}`, { description: r.skipped?.length ? r.skipped.join(" · ") : undefined });
      onDone(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel>
      <div className="flex flex-col gap-3 p-4">
        <Field label="Repository" hint={`Reads ${dir}/*.yaml on the default branch (or @branch). Private repos use your connected GitHub account.`} error={error ?? undefined}>
          {(wire) => (
            <Input
              {...wire}
              mono
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void run()}
              placeholder="owner/repo or owner/repo@branch"
              autoFocus
            />
          )}
        </Field>
      </div>
      <PanelFooter>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void run()} disabled={busy || !repo.trim()}>
          <Github className="size-4" />
          Import
        </Button>
      </PanelFooter>
    </Panel>
  );
}
