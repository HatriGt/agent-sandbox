import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Copy, Download, GitCompare, Layers, Pencil, Plus, ShieldAlert, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, type AgentChoice, type HarnessView, type ProviderView, type SkillView } from "@/lib/api";
import { DataTable, MetaLine, StatusDot, type Column } from "@/components/ui/data-table";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AnimatedTabs, TabPanel } from "@/components/ui/animated-tabs";
import { Swap } from "@/components/ui/swap";
import { Collapse } from "@/components/ui/collapse";
import { Bar } from "@/components/thread/Skeletons";
import { Panel, SettingsSection } from "@/components/ui/settings";
import { EmptyState } from "@/components/ui/empty-state";
import { DriverBadges } from "@/components/DriverPicker";
import { HarnessEditor } from "@/components/harness/HarnessEditor";
import { ImportHarness } from "@/components/harness/ImportHarness";
import { AttemptGroupList, CompareLauncher, CompareList } from "@/components/harness/Compare";
import { downloadJson, rulesLine, type HarnessDraft, draftOf, emptyDraft } from "@/components/harness/model";

const SkillsPage = React.lazy(() => import("@/components/SkillsPage").then((m) => ({ default: m.SkillsPage })));

type Tab = "saved" | "drivers" | "skills";
const ORDER: readonly Tab[] = ["drivers", "skills", "saved"];

/**
 * Harnesses: everything that shapes HOW a run works, in one place — drivers, skills, and saved
 * combinations of them (driver · model · skills · rules · egress). A saved harness is picked in the
 * composer (or on a trigger) and fills whatever the run leaves out; explicit per-run choices win.
 *
 * Three tabs, each with its own content. The former "Hooks & rules" and "Egress & budgets" tabs were
 * one more listing of the same saved harnesses each (name + one column), which read as three tabs
 * showing the same thing; rules and egress are now facts on each saved row and fields in its editor.
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
            <p className="text-muted-foreground mt-1 text-meta">How your agents work: driver, model, skills, rules and egress, saved as one pick.</p>
          </div>
          <AnimatePresence initial={false}>
            {tab === "saved" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                className="flex shrink-0 flex-wrap items-center gap-2"
              >
                <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                  <Upload className="size-4" />
                  Import
                </Button>
                <Button size="sm" onClick={() => setEditing(emptyDraft())}>
                  <Plus className="size-4" />
                  New harness
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
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
              { value: "saved", label: "Saved", badge: reviewCount ? <span className="bg-attention text-attention-ink ml-1 rounded px-1 text-micro tabular-nums">{reviewCount}</span> : undefined },
            ]}
          />
        </div>
        <TabPanel value={tab} order={ORDER} idBase="harness-tabs">
          {tab === "saved" ? (
            <Swap state={editing ? "editor" : importing ? "import" : "list"} className="flex flex-col gap-10">
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
                            <Bar className="h-3.5 w-40" />
                            <Bar className="mt-2 h-3 w-64" />
                          </div>
                        ))}
                      </Panel>
                    ) : !list.length ? (
                      <EmptyState
                        icon={Layers}
                        title="No saved harnesses yet"
                        line="Save a driver, model, skills, rules and egress together, then pick it in the composer."
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
                      <HarnessTable
                        rows={list}
                        skills={skills}
                        onEdit={(h) => setEditing(draftOf(h))}
                        onDuplicate={(h) => void mutate({ action: "duplicate", id: h.id }, "Duplicated")}
                        onExport={(h) => void exportOne(h)}
                        onDelete={(h) => void mutate({ action: "delete", id: h.id }, "Deleted")}
                        onApprove={(h) => mutate({ action: "approve", id: h.id }, `${h.name} can run now`)}
                      />
                    )}
                  </SettingsSection>
                  <Panel className="text-muted-foreground px-4 py-3 text-micro">
                    Rules and RULES.md go to the agent as system-prompt instructions for the whole thread — your task text stays as you typed it. Verify on done is enforced: the controller runs the check.
                    Executable hooks are never installed from a bundle (an imported <span className="text-foreground font-mono">hooks/</span> folder is ignored); the PR-only push guard and the supervision gate are built in and apply to every harness.
                  </Panel>
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
                    <Collapse open={comparing}>
                      <CompareLauncher
                        harnesses={list.filter((h) => !h.needsReview)}
                        onCancel={() => setComparing(false)}
                        onStarted={() => {
                          setComparing(false);
                          setCompareRefresh((n) => n + 1);
                        }}
                      />
                    </Collapse>
                    <CompareList refresh={compareRefresh} onOpenBox={onOpenBox} canStart={list.filter((h) => !h.needsReview).length >= 2} />
                  </SettingsSection>
                  <SettingsSection id="attempts" title="Attempts" purpose="Tasks run several ways in parallel. The best attempt gets the PR; you can pick another one instead.">
                    <AttemptGroupList onOpenBox={onOpenBox} />
                  </SettingsSection>
                </>
              )}
            </Swap>
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
          ) : (
            <div className="-mx-5 h-[calc(100dvh-14rem)] min-h-[32rem] md:-mx-8">
              <React.Suspense fallback={null}>
                <SkillsPage onBack={() => setTab("saved")} />
              </React.Suspense>
            </div>
          )}
        </TabPanel>
      </div>
    </div>
  );
}

/** "Updated 2h ago" / "Imported from x 3d ago" — where the harness came from and when it last changed. */
function provenance(h: HarnessView): string {
  const lead =
    h.origin?.kind === "duplicate"
      ? `Copied from ${h.origin.source ?? "a harness"} `
      : h.origin
        ? `Imported ${h.origin.source ? `from ${h.origin.source} ` : "from a file "}`
        : h.builtin && h.updatedAt === h.createdAt
          ? "Added "
          : "Updated ";
  return `${lead}${fmtAgo(h.origin?.at ?? h.updatedAt)}`;
}

const HARNESS_COLUMNS: Column<HarnessView>[] = [
  {
    id: "name",
    header: "Harness",
    primary: true,
    sort: (h) => h.name,
    cell: (h) => {
      const facts = [
        h.skills?.length ? `${h.skills.length} skill${h.skills.length === 1 ? "" : "s"}` : null,
        rulesLine(h.rules),
        h.rulesMd ? "RULES.md" : null,
        h.verifyCommand ? `verify: ${h.verifyCommand}` : null,
        h.egress?.length ? `egress: ${h.egress.join(", ")}` : null,
      ];
      return (
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{h.name}</span>
            {h.builtin && <span className="text-muted-foreground shrink-0 rounded border px-1.5 text-micro font-normal" title="A best-practice default. Edit it freely, duplicate it, or delete it to hide it.">built-in</span>}
          </span>
          {h.description && <span className="text-muted-foreground truncate text-micro font-normal">{h.description}</span>}
          <MetaLine className="font-normal" parts={facts} />
        </span>
      );
    },
  },
  {
    id: "state",
    header: "Status",
    width: "w-36",
    sort: (h) => (h.needsReview ? 0 : h.providerMissing ? 1 : 2),
    cell: (h) => (h.needsReview ? <StatusDot tone="attention">needs review</StatusDot> : h.providerMissing ? <StatusDot tone="destructive">provider removed</StatusDot> : <StatusDot tone="ok">ready</StatusDot>),
  },
  {
    id: "model",
    header: "Driver · model",
    width: "w-48",
    hideBelow: "md",
    sort: (h) => `${h.driver ?? ""} ${h.provider?.label ?? ""} ${h.model ?? ""}`,
    cell: (h) => <MetaLine parts={[h.driver ?? "default driver", h.provider ? `${h.provider.label}${h.model ? ` · ${h.model}` : ""}` : (h.model ?? null)]} />,
  },
  {
    id: "updated",
    header: "Updated",
    width: "w-32",
    hideBelow: "lg",
    sort: (h) => h.origin?.at ?? h.updatedAt,
    cell: (h) => (
      <span className="text-faint block truncate text-micro" title={provenance(h)}>
        {fmtAgo(h.origin?.at ?? h.updatedAt)}
      </span>
    ),
  },
];

/**
 * Saved harnesses as a table. A row opens the editor; an imported harness that still needs review
 * opens its review sheet instead, since it may not run (or be edited blind) until approved.
 */
function HarnessTable({
  rows,
  skills,
  onEdit,
  onDuplicate,
  onExport,
  onDelete,
  onApprove,
}: {
  rows: HarnessView[];
  skills: SkillView[];
  onEdit: (h: HarnessView) => void;
  onDuplicate: (h: HarnessView) => void;
  onExport: (h: HarnessView) => void;
  onDelete: (h: HarnessView) => void;
  onApprove: (h: HarnessView) => Promise<unknown>;
}) {
  const [reviewing, setReviewing] = React.useState<string | null>(null);
  const shown = rows.find((h) => h.id === reviewing && h.needsReview) ?? null;
  return (
    <>
      <DataTable
        aria-label="Saved harnesses"
        rows={rows}
        columns={HARNESS_COLUMNS}
        rowKey={(h) => h.id}
        onRowClick={(h) => (h.needsReview ? setReviewing(h.id) : onEdit(h))}
        rowLabel={(h) => (h.needsReview ? `Review ${h.name}` : `Edit ${h.name}`)}
        rowProps={(h) => ({ className: h.needsReview ? "bg-attention/5" : undefined })}
        minWidth="min-w-[36rem]"
        search={rows.length > 8 ? { placeholder: "Search harnesses", text: (h) => [h.name, h.description, h.driver, h.provider?.label, h.model, ...(h.skills ?? [])].filter(Boolean).join(" ") } : undefined}
        actions={(h) => (
          <span className="inline-flex items-center gap-0.5">
            {h.needsReview ? (
              <Button variant="attention" size="xs" onClick={() => setReviewing(h.id)}>
                Review
              </Button>
            ) : (
              <Button variant="ghost" size="icon-xs" onClick={() => onEdit(h)} aria-label={`Edit ${h.name}`} title="Edit">
                <Pencil />
              </Button>
            )}
            <Button variant="ghost" size="icon-xs" onClick={() => onDuplicate(h)} aria-label={`Duplicate ${h.name}`} title="Duplicate">
              <Copy />
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={() => onExport(h)} aria-label={`Export ${h.name}`} title="Export bundle">
              <Download />
            </Button>
            <ArmButton size="icon-xs" variant="ghost" icon={<Trash2 />} label={`Delete ${h.name}`} armedLabel="Delete" onConfirm={() => onDelete(h)} />
          </span>
        )}
      />
      <Sheet open={!!shown} onOpenChange={(o) => !o && setReviewing(null)}>
        {shown && (
          <SheetContent title={`Review ${shown.name}`} description={provenance(shown)} className="w-[min(36rem,calc(100vw-2rem))]">
            <ReviewPanel
              h={shown}
              skills={skills}
              onApprove={() => void onApprove(shown).then((r) => r && setReviewing(null))}
              onEdit={() => {
                setReviewing(null);
                onEdit(shown);
              }}
            />
          </SheetContent>
        )}
      </Sheet>
    </>
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
      <ReviewItem label="Rules given to the agent (system prompt, every turn)">
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
