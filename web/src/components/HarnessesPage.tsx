import * as React from "react";
import { ArrowLeft, Copy, Download, GitCompare, Layers, Pencil, Plus, ShieldAlert, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, type AgentChoice, type HarnessView, type ProviderView, type SkillView } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { AnimatedTabs, TabPanel } from "@/components/ui/animated-tabs";
import { Panel, SettingsSection } from "@/components/ui/settings";
import { EmptyState } from "@/components/ui/empty-state";
import { DriverBadges } from "@/components/DriverPicker";
import { HarnessEditor } from "@/components/harness/HarnessEditor";
import { ImportHarness } from "@/components/harness/ImportHarness";
import { AttemptGroupList, CompareLauncher, CompareList } from "@/components/harness/Compare";
import { budgetLine, downloadJson, rulesLine, type HarnessDraft, draftOf, emptyDraft } from "@/components/harness/model";

const SkillsPage = React.lazy(() => import("@/components/SkillsPage").then((m) => ({ default: m.SkillsPage })));

type Tab = "saved" | "drivers" | "skills" | "rules" | "egress";
const ORDER: readonly Tab[] = ["drivers", "skills", "rules", "egress", "saved"];

/**
 * Harnesses: everything that shapes HOW a run works, in one place — drivers, skills, rules/hooks,
 * egress and budgets — plus saved combinations of them. A saved harness is picked in the composer
 * (or on a trigger) and fills whatever the run leaves out; explicit per-run choices still win.
 */
export function HarnessesPage({ onBack, onOpenBox }: { onBack: () => void; onOpenBox?: (box: string) => void }) {
  const [tab, setTab] = React.useState<Tab>("saved");
  const [harnesses, setHarnesses] = React.useState<HarnessView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [builtinCount, setBuiltinCount] = React.useState(0);
  const [drivers, setDrivers] = React.useState<AgentChoice[]>([]);
  const [defaultDriver, setDefaultDriver] = React.useState<string>("claude");
  const [providers, setProviders] = React.useState<ProviderView[]>([]);
  const [skills, setSkills] = React.useState<SkillView[]>([]);
  const [editing, setEditing] = React.useState<HarnessDraft | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [comparing, setComparing] = React.useState(false);
  const [compareRefresh, setCompareRefresh] = React.useState(0);

  const reload = React.useCallback(() => {
    api
      .harnesses()
      .then((r) => {
        setHarnesses(r.harnesses);
        setBuiltinCount(r.builtins ?? 0);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  React.useEffect(() => {
    reload();
    api.agentPrefs().then((p) => {
      setDrivers(p.agents ?? []);
      setDefaultDriver(p.defaultAgent);
    }).catch(() => {});
    api.providers().then((p) => setProviders(p.providers ?? [])).catch(() => {});
    api.skills().then((s) => setSkills(s.skills ?? [])).catch(() => {});
  }, [reload]);

  const mutate = async (body: Record<string, unknown>, ok?: string) => {
    try {
      const r = await api.harnessMutate(body);
      setHarnesses(r.harnesses);
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    }
  };

  const exportOne = async (h: HarnessView) => {
    try {
      const r = await api.harnessExport(h.id);
      downloadJson(r.filename, r.bundle);
      const notes = [r.redacted ? `${r.redacted} secret-shaped value${r.redacted === 1 ? "" : "s"} redacted` : "", r.skipped.length ? `${r.skipped.length} secret file${r.skipped.length === 1 ? "" : "s"} left out` : ""].filter(Boolean);
      toast.success(`Exported ${h.name}`, { description: notes.join(" · ") || "No keys or tokens are ever included." });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const list = harnesses ?? [];
  const reviewCount = list.filter((h) => h.needsReview).length;

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em]">Harnesses</h1>
            <p className="text-muted-foreground mt-1 text-meta">How your agents work: driver, model, skills, rules, egress and budget, saved as one pick.</p>
          </div>
          {tab === "saved" && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                <Upload className="size-4" />
                Import
              </Button>
              <Button size="sm" onClick={() => setEditing(emptyDraft())}>
                <Plus className="size-4" />
                New harness
              </Button>
            </div>
          )}
        </header>
        <div className="-mx-1 mb-6 overflow-x-auto px-1 pb-1">
          <AnimatedTabs
            value={tab}
            onChange={setTab}
            size="md"
            ariaLabel="Harness sections"
            idBase="harness-tabs"
            items={[
              { value: "drivers", label: "Drivers" },
              { value: "skills", label: "Skills" },
              // Phone: the full labels wrapped to three lines inside the pill; the short form fits.
              { value: "rules", label: <span className="whitespace-nowrap">Hooks<span className="hidden sm:inline"> & rules</span></span> },
              { value: "egress", label: <span className="whitespace-nowrap">Egress<span className="hidden sm:inline"> & budgets</span></span> },
              { value: "saved", label: "Saved", badge: reviewCount ? <span className="bg-attention text-attention-ink ml-1 rounded px-1 text-micro tabular-nums">{reviewCount}</span> : undefined },
            ]}
          />
        </div>
        <TabPanel value={tab} order={ORDER} idBase="harness-tabs">
          {tab === "saved" ? (
            <div className="flex flex-col gap-10">
              {editing ? (
                <HarnessEditor
                  draft={editing}
                  drivers={drivers}
                  providers={providers}
                  skills={skills}
                  onCancel={() => setEditing(null)}
                  onSave={async (body, id) => {
                    const r = await mutate({ action: "upsert", ...(id ? { id } : {}), harness: body }, id ? "Harness saved" : "Harness created");
                    if (r) setEditing(null);
                  }}
                />
              ) : importing ? (
                <ImportHarness
                  onCancel={() => setImporting(false)}
                  onImported={(r) => {
                    setHarnesses(r.harnesses);
                    setImporting(false);
                    api.skills().then((s) => setSkills(s.skills)).catch(() => {});
                  }}
                />
              ) : (
                <>
                  <SettingsSection
                    id="saved"
                    title="Saved harnesses"
                    meta={harnesses ? list.length : undefined}
                    purpose="Built-ins are best-practice starting points: edit them, duplicate them, or delete the ones you don't use."
                    actions={
                      harnesses && list.filter((h) => h.builtin).length < builtinCount ? (
                        <Button variant="ghost" size="sm" onClick={() => void mutate({ action: "restore-defaults" }, "Built-in harnesses restored")}>
                          Restore built-ins
                        </Button>
                      ) : undefined
                    }
                  >
                    {error ? (
                      <EmptyState icon={ShieldAlert} tone="destructive" title="Couldn't load harnesses" line={error} action={<Button variant="outline" size="sm" onClick={reload}>Retry</Button>} />
                    ) : !harnesses ? (
                      <Panel className="divide-y">
                        {[0, 1].map((i) => (
                          <div key={i} className="h-[4.25rem] px-4 py-3">
                            <div className="bg-muted h-3.5 w-40 animate-pulse rounded" />
                            <div className="bg-muted mt-2 h-3 w-64 animate-pulse rounded" />
                          </div>
                        ))}
                      </Panel>
                    ) : !list.length ? (
                      <EmptyState
                        icon={Layers}
                        title="No saved harnesses yet"
                        line="Save a driver, model, skills, rules and budget together, then pick it in the composer."
                        action={
                          <>
                            <Button size="sm" onClick={() => setEditing(emptyDraft())}>
                              <Plus className="size-4" />
                              New harness
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                              <Upload className="size-4" />
                              Import a bundle
                            </Button>
                          </>
                        }
                      />
                    ) : (
                      <Panel className="divide-y">
                        {list.map((h) => (
                          <HarnessRow
                            key={h.id}
                            h={h}
                            skills={skills}
                            onEdit={() => setEditing(draftOf(h))}
                            onDuplicate={() => void mutate({ action: "duplicate", id: h.id }, "Duplicated")}
                            onExport={() => void exportOne(h)}
                            onDelete={() => void mutate({ action: "delete", id: h.id }, "Deleted")}
                            onApprove={() => void mutate({ action: "approve", id: h.id }, `${h.name} can run now`)}
                          />
                        ))}
                      </Panel>
                    )}
                  </SettingsSection>
                  <SettingsSection
                    id="compare"
                    title="Compare"
                    purpose="Run one task on two harnesses: two ordinary runs, side by side. Only what the runs reported is shown."
                    actions={
                      list.filter((h) => !h.needsReview).length >= 2 && !comparing ? (
                        <Button variant="outline" size="sm" onClick={() => setComparing(true)}>
                          <GitCompare className="size-4" />
                          New compare
                        </Button>
                      ) : undefined
                    }
                  >
                    {comparing && (
                      <CompareLauncher
                        harnesses={list.filter((h) => !h.needsReview)}
                        onCancel={() => setComparing(false)}
                        onStarted={() => {
                          setComparing(false);
                          setCompareRefresh((n) => n + 1);
                        }}
                      />
                    )}
                    <CompareList refresh={compareRefresh} onOpenBox={onOpenBox} canStart={list.filter((h) => !h.needsReview).length >= 2} />
                  </SettingsSection>
                  <SettingsSection id="attempts" title="Attempts" purpose="Tasks run several ways in parallel. The best attempt gets the PR; you can pick another one instead.">
                    <AttemptGroupList onOpenBox={onOpenBox} />
                  </SettingsSection>
                </>
              )}
            </div>
          ) : tab === "drivers" ? (
            <SettingsSection id="drivers" title="Drivers" purpose="The coding agent a run starts. A harness can pin one; otherwise your default is used.">
              <Panel className="divide-y">
                {drivers.map((d) => (
                  <div key={d.id} className="flex flex-col gap-1.5 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-body font-medium">{d.label}</span>
                      {d.id === defaultDriver && <span className="text-muted-foreground text-micro">default</span>}
                      <span className="text-faint ml-auto text-micro tabular-nums">{list.filter((h) => h.driver === d.id).length || "—"} harness{list.filter((h) => h.driver === d.id).length === 1 ? "" : "es"}</span>
                    </div>
                    <DriverBadges choice={d} />
                  </div>
                ))}
              </Panel>
            </SettingsSection>
          ) : tab === "skills" ? (
            <div className="-mx-5 h-[calc(100dvh-14rem)] min-h-[32rem] md:-mx-8">
              <React.Suspense fallback={null}>
                <SkillsPage onBack={() => setTab("saved")} />
              </React.Suspense>
            </div>
          ) : tab === "rules" ? (
            <div className="flex flex-col gap-10">
              <SettingsSection
                id="rules"
                title="Rules"
                purpose="Rule toggles and RULES.md are instructions placed above the task — the agent is told, not forced. Verify-on-done is enforced: the controller runs the check."
              >
                <RulesTable list={list} onEdit={(h) => { setTab("saved"); setEditing(draftOf(h)); }} />
              </SettingsSection>
              <SettingsSection id="hooks" title="Hooks" purpose="Executable hooks are never installed from a bundle. The PR-only push guard and the supervision gate are built in and apply to every harness.">
                <Panel className="px-4 py-3 text-meta text-muted-foreground">
                  An imported <span className="font-mono text-foreground">hooks/</span> folder is ignored. An imported <span className="font-mono text-foreground">verify.sh</span> stays off until you review and approve the harness.
                </Panel>
              </SettingsSection>
            </div>
          ) : (
            <SettingsSection id="egress" title="Egress & budgets" purpose="Extra hosts a run may reach beyond the defaults, and the caps it is asked about when hit. A run's own choices replace these.">
              {list.length ? (
                <Panel className="divide-y">
                  {list.map((h) => (
                    <button key={h.id} type="button" onClick={() => { setTab("saved"); setEditing(draftOf(h)); }} className="hover:bg-muted/50 flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors sm:flex-row sm:items-center sm:gap-4">
                      <span className="text-foreground min-w-0 truncate text-body font-medium sm:w-44 sm:shrink-0">{h.name}</span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-micro">{h.egress?.length ? h.egress.join(", ") : "default egress"}</span>
                      <span className="text-muted-foreground text-micro tabular-nums sm:shrink-0">{budgetLine(h.budget)}</span>
                    </button>
                  ))}
                </Panel>
              ) : (
                <EmptyState icon={Layers} title="Nothing configured yet" line="Egress extras and budgets are set per harness." action={<Button size="sm" onClick={() => { setTab("saved"); setEditing(emptyDraft()); }}>New harness</Button>} />
              )}
            </SettingsSection>
          )}
        </TabPanel>
      </div>
    </div>
  );
}

function RulesTable({ list, onEdit }: { list: HarnessView[]; onEdit: (h: HarnessView) => void }) {
  if (!list.length) return <p className="text-muted-foreground text-meta">No harnesses yet.</p>;
  return (
    <Panel className="divide-y">
      {list.map((h) => (
        <button key={h.id} type="button" onClick={() => onEdit(h)} className="hover:bg-muted/50 flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors">
          <span className="flex items-center gap-2">
            <span className="text-foreground text-body font-medium">{h.name}</span>
            <span className="text-muted-foreground text-micro">{rulesLine(h.rules)}</span>
          </span>
          {(h.verifyCommand || h.rulesMd) && (
            <span className="text-faint truncate font-mono text-micro">{h.verifyCommand ? `verify: ${h.verifyCommand}` : `RULES.md · ${h.rulesMd!.length} chars`}</span>
          )}
        </button>
      ))}
    </Panel>
  );
}

function HarnessRow({
  h,
  skills,
  onEdit,
  onDuplicate,
  onExport,
  onDelete,
  onApprove,
}: {
  h: HarnessView;
  skills: SkillView[];
  onEdit: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onApprove: () => void;
}) {
  const [armed, setArmed] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const facts = [
    h.driver ?? "default driver",
    h.provider ? `${h.provider.label}${h.model ? ` · ${h.model}` : ""}` : h.model ?? null,
    h.skills?.length ? `${h.skills.length} skill${h.skills.length === 1 ? "" : "s"}` : null,
    rulesLine(h.rules),
  ].filter(Boolean);
  return (
    <div className={cn("px-4 py-3", h.needsReview && "bg-attention/5")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-body font-medium">{h.name}</span>
            {h.builtin && <span className="text-muted-foreground rounded border px-1.5 text-micro" title="A best-practice default. Edit it freely, duplicate it, or delete it to hide it.">built-in</span>}
            {h.needsReview && <span className="bg-attention text-attention-ink rounded px-1.5 text-micro font-medium">needs review</span>}
            {h.providerMissing && <span className="text-destructive text-micro">provider removed</span>}
          </div>
          {h.description && <p className="text-muted-foreground mt-0.5 truncate text-micro">{h.description}</p>}
          <p className="text-muted-foreground mt-0.5 truncate text-micro">{facts.join(" · ")}</p>
          <p className="text-faint text-micro">
            {h.origin?.kind === "duplicate"
              ? `Copied from ${h.origin.source ?? "a harness"} `
              : h.origin
                ? `Imported ${h.origin.source ? `from ${h.origin.source} ` : "from a file "}`
                : h.builtin && h.updatedAt === h.createdAt
                  ? "Added "
                  : "Updated "}
            {fmtAgo(h.origin?.at ?? h.updatedAt)}
          </p>
        </div>
        <div className="-ml-2 flex shrink-0 items-center gap-0.5 sm:ml-0">
          {h.needsReview ? (
            <Button variant="attention" size="xs" onClick={() => setReviewOpen((v) => !v)}>
              {reviewOpen ? "Hide review" : "Review"}
            </Button>
          ) : (
            <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label={`Edit ${h.name}`} title="Edit">
              <Pencil />
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={onDuplicate} aria-label={`Duplicate ${h.name}`} title="Duplicate">
            <Copy />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onExport} aria-label={`Export ${h.name}`} title="Export bundle">
            <Download />
          </Button>
          <Button
            variant={armed ? "destructive" : "ghost"}
            size={armed ? "xs" : "icon-xs"}
            onClick={() => (armed ? onDelete() : setArmed(true))}
            onBlur={() => setArmed(false)}
            aria-label={`Delete ${h.name}`}
            title="Delete"
          >
            {armed ? "Delete" : <Trash2 />}
          </Button>
        </div>
      </div>
      {h.needsReview && reviewOpen && <ReviewPanel h={h} skills={skills} onApprove={onApprove} onEdit={onEdit} />}
    </div>
  );
}

/** What an imported harness would do, verbatim, before it may run. */
function ReviewPanel({ h, skills, onApprove, onEdit }: { h: HarnessView; skills: SkillView[]; onApprove: () => void; onEdit: () => void }) {
  const known = new Set(skills.map((s) => s.name));
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-muted-foreground text-micro">Imported harnesses cannot run until approved. Read what it will do:</p>
      <ReviewItem label="verify.sh — runs inside the sandbox after each run">
        {h.verifyCommand ? <pre className="bg-muted overflow-x-auto rounded p-2 font-mono text-micro whitespace-pre-wrap">{h.verifyCommand}</pre> : <span className="text-faint">none</span>}
      </ReviewItem>
      <ReviewItem label="Egress — extra hosts the sandbox may reach">
        {h.egress?.length ? <span className="font-mono text-micro">{h.egress.join(", ")}</span> : <span className="text-faint">none beyond the defaults</span>}
      </ReviewItem>
      <ReviewItem label="Rules placed above every task">
        <span className="text-micro">{rulesLine(h.rules)}</span>
        {h.rulesMd && <pre className="bg-muted mt-1 max-h-48 overflow-auto rounded p-2 font-mono text-micro whitespace-pre-wrap">{h.rulesMd}</pre>}
      </ReviewItem>
      <ReviewItem label="Skills installed into the sandbox">
        {h.skills?.length ? (
          <span className="text-micro">{h.skills.map((s) => (known.has(s) ? s : `${s} (missing)`)).join(", ")}</span>
        ) : (
          <span className="text-faint">none</span>
        )}
      </ReviewItem>
      {h.unresolvedProvider && (
        <p className="text-attention text-micro">
          Expects a {h.unresolvedProvider.kind} provider ("{h.unresolvedProvider.label}"). Connect one on Integrations, then pick it in the editor.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onApprove}>Approve and enable</Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit first
        </Button>
      </div>
    </div>
  );
}

function ReviewItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="label text-muted-foreground">{label}</span>
      <div className="text-foreground min-w-0">{children}</div>
    </div>
  );
}
