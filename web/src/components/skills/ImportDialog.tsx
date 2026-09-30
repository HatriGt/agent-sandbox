import * as React from "react";
import { Check, ClipboardPaste, Download, FileUp, Files, Github, Loader2, Search, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { SkillMark } from "@/lib/skillGlyph";
import { fetchRepoFile, fetchRepoSkill, listRepoSkills, parseRepoInput, parseSkillMd, type RepoRef, type RepoSkillEntry } from "@/lib/skillImport";
import { cn } from "@/lib/utils";
import { AnimatedTabs, TabPanel } from "@/components/ui/animated-tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { type Draft, fmtBundle } from "./model";

/** Public repos that actually carry skills in the SKILL.md format — a starting point, not a store. */
const FEATURED_REPOS = [
  { repo: "anthropics/skills", blurb: "Anthropic's own collection — documents, design, research" },
  { repo: "anthropics/claude-code", blurb: "Skills shipped with Claude Code" },
];

type Source = "github" | "paste" | "upload";
const ORDER: Source[] = ["github", "paste", "upload"];

/**
 * Import: three sources side by side — GitHub (browse a repo, pick, preview, import), paste
 * (markdown in, preview, review in the editor) and upload (files from disk). Every single import
 * shows what it will become before it lands: name, description, files, the first lines. One skill
 * always opens in the editor for review; several save straight in with one toast.
 */
export function ImportDialog({
  open,
  existing,
  onClose,
  onImported,
  onEditOne,
  presetRepo,
}: {
  open: boolean;
  existing: Record<string, true>;
  /** Open straight onto a repository's listing (the library's curated teaser). */
  presetRepo?: string;
  onClose: () => void;
  onImported: (count: number) => void | Promise<void>;
  onEditOne: (d: Draft) => void;
}) {
  const [source, setSource] = React.useState<Source>("github");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    if (!open) setSource("github");
  }, [open]);

  // From disk: one file opens in the editor for review, several are saved straight in.
  const importFiles = async (list: FileList | File[] | null) => {
    const files = list ? Array.from(list).filter((f) => /\.(md|markdown|txt)$/i.test(f.name)) : [];
    if (!files.length) return;
    const drafts = await Promise.all(files.map(async (f) => parseSkillMd(await f.text(), f.name)));
    if (drafts.length === 1) return onEditOne(drafts[0]);
    let saved = 0;
    for (const d of drafts) {
      try {
        await api.skillMutate({ action: "upsert", skill: { ...d, enabled: true } });
        saved++;
      } catch (e) {
        toast.error(`Could not import /${d.name}`, { description: e instanceof Error ? e.message : String(e) });
      }
    }
    if (saved) await onImported(saved);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Import a skill" description="Skill folders come in whole — SKILL.md plus scripts and docs. You review before anything goes live." className="w-[min(44rem,calc(100vw-2rem))]">
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt"
          multiple
          className="hidden"
          onChange={(e) => {
            void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <AnimatedTabs
          ariaLabel="Import source"
          value={source}
          onChange={setSource}
          size="md"
          idBase="import-src"
          className="mb-4 w-full [&>button]:flex-1"
          items={[
            { value: "github", icon: <Github className="size-3.5" />, label: "GitHub" },
            { value: "paste", icon: <ClipboardPaste className="size-3.5" />, label: "Paste markdown" },
            { value: "upload", icon: <FileUp className="size-3.5" />, label: "Upload" },
          ]}
        />
        <TabPanel value={source} order={ORDER} idBase="import-src" className="min-h-[18rem]">
          {source === "github" ? (
            <GitHubStep existing={existing} onClose={onClose} onImported={onImported} onEditOne={onEditOne} preset={presetRepo} />
          ) : source === "paste" ? (
            <PasteStep onEditOne={onEditOne} />
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void importFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex min-h-[18rem] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 text-center transition-[border-color,background-color] duration-150",
                dragging ? "border-live bg-live/5" : "hover:border-line-strong hover:bg-muted/40"
              )}
            >
              <span className={cn("grid size-11 place-items-center rounded-full transition-colors", dragging ? "bg-live/10 text-live" : "bg-muted text-muted-foreground")} aria-hidden>
                <FileUp className="size-5" strokeWidth={1.75} />
              </span>
              <span className="text-foreground text-body font-medium">Drop SKILL.md files here, or click to choose</span>
              <span className="text-muted-foreground max-w-[36ch] text-meta">One file opens in the editor for review. Several are saved straight in, each named from its frontmatter.</span>
              <span className="text-faint stamp mt-1">.md · .markdown · .txt</span>
            </button>
          )}
        </TabPanel>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── preview card ───────────────────────────── */

/** What the import will become — the same object the library shows, plus the first lines. */
function SkillPreview({ draft, files, existing, loading }: { draft: Draft | null; files?: number; existing?: boolean; loading?: boolean }) {
  const still = useReducedMotion();
  const excerpt = React.useMemo(() => {
    if (!draft) return [];
    return draft.content
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 4);
  }, [draft]);
  return (
    <AnimatePresence mode="wait" initial={false}>
      {(draft || loading) && (
        <motion.div
          key={loading ? "loading" : draft?.name}
          initial={still ? { opacity: 0 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="bg-muted/30 overflow-hidden rounded-xl border"
          aria-busy={loading || undefined}
        >
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", loading ? "shimmer" : "bg-live/10 text-live")} aria-hidden>
              {!loading && draft && <SkillMark name={draft.name} size={16} />}
            </span>
            <span className="min-w-0 flex-1">
              {loading || !draft ? (
                <>
                  <span className="shimmer block h-3 w-28 rounded" />
                  <span className="shimmer mt-1.5 block h-2.5 w-52 rounded" />
                </>
              ) : (
                <>
                  <span className="flex items-center gap-2">
                    <span className="stamp text-foreground truncate text-[13px] font-medium">/{draft.name}</span>
                    {existing && <span className="text-attention-text bg-attention/15 shrink-0 rounded px-1.5 py-px text-micro font-medium">replaces yours</span>}
                  </span>
                  <span className="text-muted-foreground block truncate text-meta">{draft.description}</span>
                </>
              )}
            </span>
            {!loading && (files ?? 0) > 0 && (
              <span className="text-faint tabular flex shrink-0 items-center gap-1 text-micro">
                <Files className="size-3" aria-hidden />
                {(files ?? 0) + 1}
              </span>
            )}
          </div>
          {!loading && excerpt.length > 0 && (
            <pre className="stamp text-muted-foreground border-t px-3.5 py-2.5 text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {excerpt.join("\n")}
              {draft && draft.content.split("\n").filter((l) => l.trim()).length > 4 && <span className="text-faint">{"\n…"}</span>}
            </pre>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────── paste ───────────────────────────── */

function PasteStep({ onEditOne }: { onEditOne: (d: Draft) => void }) {
  const [text, setText] = React.useState("");
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => ref.current?.focus(), []);
  const parsed = text.trim() ? parseSkillMd(text, "pasted-skill") : null;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed) onEditOne(parsed);
      }}
    >
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={parsed ? 7 : 10}
        spellCheck={false}
        aria-label="Markdown"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && parsed) onEditOne(parsed);
        }}
        placeholder={"---\nname: review-pr\ndescription: Use when asked to review a pull request.\n---\n\n1. Read every changed file…"}
        className={cn(inputClass, "stamp h-auto resize-y py-2.5 text-[12.5px] leading-relaxed transition-[height]")}
      />
      <p className="text-faint -mt-1 text-micro">Frontmatter (name, description) is read when present; otherwise the first heading and paragraph are used. You can fix anything in the editor.</p>
      <SkillPreview draft={parsed} />
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" size="sm" disabled={!parsed}>
          Review in editor
          <Kbd className="text-primary-foreground/70 border-primary-foreground/20 hidden bg-transparent sm:inline-flex">⌘↵</Kbd>
        </Button>
      </div>
    </form>
  );
}

/* ───────────────────────────── GitHub ───────────────────────────── */

/**
 * Browse a GitHub repository for skills and pull them in. The controller does the fetching — with
 * a saved GitHub token when one covers the repo, so private repositories work too. Picking exactly
 * one loads a preview; several import in one go.
 */
function GitHubStep({ existing, onClose, onImported, onEditOne, preset }: { existing: Record<string, true>; onClose: () => void; onImported: (count: number) => void | Promise<void>; onEditOne: (d: Draft) => void; preset?: string }) {
  const [input, setInput] = React.useState(preset ?? "");
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [found, setFound] = React.useState<{ ref: RepoRef; branch: string; entries: RepoSkillEntry[]; authed: boolean } | null>(null);
  const [picked, setPicked] = React.useState<Record<string, true>>({});
  const [importing, setImporting] = React.useState(false);
  const [preview, setPreview] = React.useState<{ path: string; draft: Draft | null; loading: boolean } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (preset) void browse(preset);
    else inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pickedPaths = Object.keys(picked);
  const pickedCount = pickedPaths.length;

  const loadDraft = React.useCallback(
    async (f: RepoSkillEntry): Promise<Draft> => {
      if (!found) throw new Error("No repository");
      if (f.kind === "dir") {
        const r = await fetchRepoSkill(found.ref, found.branch, f.path);
        if (r.skipped.length) toast.info(`/${f.name}: ${r.skipped.length} file${r.skipped.length === 1 ? "" : "s"} skipped`, { description: r.skipped.slice(0, 5).join(", ") });
        return { ...parseSkillMd(r.skillMd, f.name), files: r.files };
      }
      return parseSkillMd(await fetchRepoFile(found.ref, found.branch, f.path), f.name);
    },
    [found]
  );

  // Exactly one picked → fetch and show what it will become.
  React.useEffect(() => {
    if (!found || pickedCount !== 1) {
      setPreview(null);
      return;
    }
    const path = pickedPaths[0];
    const entry = found.entries.find((e) => e.path === path);
    if (!entry) return;
    let alive = true;
    setPreview({ path, draft: null, loading: true });
    loadDraft(entry)
      .then((d) => alive && setPreview({ path, draft: d, loading: false }))
      .catch((e: unknown) => {
        if (!alive) return;
        setPreview(null);
        setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, pickedCount, pickedPaths[0], loadDraft]);

  const browse = async (raw: string) => {
    setErr(null);
    setFound(null);
    setPicked({});
    setLoading(true);
    try {
      const ref = parseRepoInput(raw);
      const r = await listRepoSkills(ref);
      if (!r.entries.length) setErr("No skills here — the repo has no SKILL.md folders or skills/ markdown.");
      else setFound({ ref, ...r });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const doImport = async () => {
    if (!found || !pickedCount) return;
    setImporting(true);
    try {
      if (pickedCount === 1 && preview?.draft) return onEditOne(preview.draft);
      const entries = found.entries.filter((f) => picked[f.path]);
      const drafts = await Promise.all(entries.map(loadDraft));
      if (drafts.length === 1) return onEditOne(drafts[0]);
      let saved = 0;
      for (const d of drafts) {
        try {
          await api.skillMutate({ action: "upsert", skill: { ...d, enabled: true } });
          saved++;
        } catch (e) {
          toast.error(`Could not import /${d.name}`, { description: e instanceof Error ? e.message : String(e) });
        }
      }
      if (saved) await onImported(saved);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void browse(input);
        }}
      >
        <label className={cn(inputClass, "flex min-w-0 flex-1 items-center gap-2 px-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40")}>
          <Github className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="owner/repo, or paste a github.com URL to a skill folder"
            aria-label="Repository"
            spellCheck={false}
            className="text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-meta outline-none"
          />
        </label>
        <Button type="submit" size="default" variant="outline" disabled={!input.trim() || loading} loading={loading}>
          <Search />
          Browse
        </Button>
      </form>

      {!found && !loading && !err && (
        <div>
          <p className="label text-muted-foreground mb-2 flex items-center gap-1.5">
            <Sparkles className="size-3" aria-hidden />
            Curated
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {FEATURED_REPOS.map((f) => (
              <li key={f.repo}>
                <button
                  type="button"
                  onClick={() => {
                    setInput(f.repo);
                    void browse(f.repo);
                  }}
                  className="group bg-card hover:border-line-strong flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-left transition-[border-color,transform,box-shadow] duration-150 ease-out active:scale-[0.985] [@media(hover:hover)]:hover:shadow-e1"
                >
                  <span className="bg-muted text-muted-foreground group-hover:text-foreground grid size-8 shrink-0 place-items-center rounded-lg transition-colors" aria-hidden>
                    <Github className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="stamp text-foreground block truncate text-[13px] font-medium">{f.repo}</span>
                    <span className="text-muted-foreground block text-micro leading-snug">{f.blurb}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-faint mt-3 text-micro">Private repositories work through a connected GitHub account (Integrations).</p>
        </div>
      )}

      {loading && (
        <div className="divide-y overflow-hidden rounded-xl border" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <span className="shimmer size-4 rounded-[3px]" />
              <span className="shimmer size-4 rounded" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="shimmer block h-3 w-28 rounded" />
                <span className="shimmer block h-2.5 w-40 rounded" />
              </span>
            </div>
          ))}
        </div>
      )}

      {err && (
        <p role="alert" className="text-destructive bg-destructive/5 rounded-lg border border-destructive/20 px-3 py-2 text-meta">
          {err}
        </p>
      )}

      {found && (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-muted-foreground min-w-0 truncate text-meta">
              <span className="stamp text-foreground">
                {found.ref.owner}/{found.ref.repo}
              </span>{" "}
              @ {found.branch} · {found.entries.length} found
              {found.authed && <span className="text-faint"> · via your saved GitHub token</span>}
            </p>
            <button
              type="button"
              onClick={() => setPicked(pickedCount === found.entries.length ? {} : Object.fromEntries(found.entries.map((f) => [f.path, true])))}
              className="text-live shrink-0 cursor-pointer text-meta font-medium hover:underline"
            >
              {pickedCount === found.entries.length ? "Clear" : "Select all"}
            </button>
          </div>
          <ul className="max-h-60 divide-y overflow-y-auto rounded-xl border" role="group" aria-label="Skills found">
            {found.entries.map((f) => {
              const on = !!picked[f.path];
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() =>
                      setPicked((p) => {
                        const n = { ...p };
                        if (n[f.path]) delete n[f.path];
                        else n[f.path] = true;
                        return n;
                      })
                    }
                    className={cn("hover:bg-muted/50 flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors duration-100", on && "bg-live/5")}
                  >
                    <span className={cn("grid size-4 shrink-0 place-items-center rounded-[4px] border transition-[background-color,border-color] duration-120", on ? "bg-live border-live text-white" : "bg-background")}>
                      {on && <Check className="size-3" aria-hidden />}
                    </span>
                    <SkillMark name={f.name} size={16} className="text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="stamp text-foreground block truncate text-meta font-medium">/{f.name}</span>
                      <span className="text-faint block truncate text-micro">{f.path || "(repository root)"}</span>
                    </span>
                    {f.kind === "dir" && f.fileCount > 1 && <span className="text-muted-foreground shrink-0 text-micro">{fmtBundle(f.fileCount, f.totalBytes)}</span>}
                    {existing[f.name] && <span className="text-attention-text shrink-0 text-micro">replaces yours</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {pickedCount === 1 && preview && <SkillPreview draft={preview.draft} loading={preview.loading} files={preview.draft?.files?.length} existing={!!preview.draft && !!existing[preview.draft.name]} />}
          <div className="flex items-center justify-end gap-2">
            <span className="text-faint mr-auto text-micro">{pickedCount === 1 ? "Opens in the editor for review before it goes live." : pickedCount > 1 ? "Saved straight in, enabled." : "Pick one to preview it, or several to import at once."}</span>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void doImport()} disabled={!pickedCount || importing || (pickedCount === 1 && !!preview?.loading)} loading={importing}>
              {importing ? <Loader2 /> : <Download />}
              {pickedCount === 1 ? "Review in editor" : pickedCount ? `Import ${pickedCount}` : "Import"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
