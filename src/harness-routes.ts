import type { Express, Request, Response } from "express";
import type { Db } from "./db.js";
import {
  BUILTIN_HARNESSES,
  HARNESS_LIMITS,
  approveHarness,
  buildHarnessBundle,
  compareFacts,
  deleteHarness,
  duplicateHarness,
  ensureDefaultHarnesses,
  getHarness,
  loadHarnesses,
  parseBundleDocument,
  parseHarnessFolder,
  planImport,
  putHarness,
  upsertHarness,
  type BundleFile,
  type HarnessDef,
  type HarnessOrigin,
} from "./harness.js";
import { archivedDigestOf, createCompare, getCompare, listCompares } from "./harness-runs.js";
import { getProvider, loadProviders } from "./providers.js";
import type { SkillStore } from "./skill-store.js";
import { fetchRepoHarnessDir, resolveSkillRepoToken } from "./github-skills.js";
import type { Config } from "./config.js";

/**
 * HTTP surface for harnesses (src/harness.ts): CRUD + duplicate + approve, export (a JSON bundle
 * download), a two-step import (preview, then import — the imported harness still needs an explicit
 * approve before it can run), and side-by-side compares. Kept out of http.ts; the controller wires it.
 */
export interface HarnessRouteCtx {
  cfg: Config;
  db: Db;
  dashAuthed(req: Request, res: Response): boolean;
  ownerOf(res: Response): string;
  clientError(e: unknown): string;
  redact(s: string): string;
  loadSkills(): Promise<SkillStore>;
  /** Add skills under the store lock (import). */
  addSkills(skills: SkillStore["skills"][string][]): Promise<void>;
  /** A live digest for a box still up; null when the box is gone. */
  liveDigest(box: string): Promise<Record<string, unknown> | null>;
}

/** What the page sees: the def plus whether its provider still exists. Never a key (none is stored). */
function view(h: HarnessDef, owner: string) {
  const p = h.providerId ? getProvider(h.providerId, owner) : undefined;
  return { ...h, provider: p ? { id: p.id, kind: p.kind, label: p.label } : null, providerMissing: !!h.providerId && !p };
}

export function registerHarnessRoutes(app: Express, c: HarnessRouteCtx): void {
  // Every read seeds the built-ins an owner has not had yet (idempotent; see ensureDefaultHarnesses).
  const payload = (owner: string) => {
    ensureDefaultHarnesses(owner);
    return { harnesses: loadHarnesses(owner).map((h) => view(h, owner)), limits: HARNESS_LIMITS, builtins: BUILTIN_HARNESSES.length };
  };
  const bad = (res: Response, e: unknown, status = 400) => res.status(status).json({ error: c.clientError(e) });

  app.get("/harnesses.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    res.json(payload(c.ownerOf(res)));
  });

  app.post("/harnesses.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = c.ownerOf(res);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : undefined;
    try {
      let saved: string | undefined;
      if (b.action === "upsert") {
        const input = (b.harness ?? {}) as Record<string, unknown>;
        // A provider reference must be one of the CALLER's providers — never someone else's id.
        if (typeof input.providerId === "string" && input.providerId && !getProvider(input.providerId, owner)) throw new Error("Unknown provider.");
        saved = upsertHarness(input, id, owner).id;
      } else if (b.action === "delete") {
        if (!id || !deleteHarness(id, owner)) return void res.status(404).json({ error: "No such harness." });
      } else if (b.action === "duplicate") {
        const d = id ? duplicateHarness(id, owner) : undefined;
        if (!d) return void res.status(404).json({ error: "No such harness." });
        saved = d.id;
      } else if (b.action === "approve") {
        if (!id || !approveHarness(id, owner)) return void res.status(404).json({ error: "No such harness." });
        saved = id;
      } else if (b.action === "restore-defaults") {
        // Brings back deleted built-ins; ones still present (edited or not) are left as they are.
        ensureDefaultHarnesses(owner, { restore: true });
      } else {
        return void res.status(400).json({ error: "unknown action" });
      }
      res.json({ ...payload(owner), ...(saved ? { saved } : {}) });
    } catch (e) {
      bad(res, e);
    }
  });

  // Export: a JSON bundle mirroring the folder. Provider as {kind,label} only; every text redacted.
  app.get("/harnesses/export.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = c.ownerOf(res);
    const h = typeof req.query.id === "string" ? getHarness(req.query.id, owner) : undefined;
    if (!h) return void res.status(404).json({ error: "No such harness." });
    try {
      const store = await c.loadSkills();
      const p = h.providerId ? getProvider(h.providerId, owner) : undefined;
      const out = buildHarnessBundle(h, { provider: p, skills: Object.values(store.skills), redact: c.redact });
      const filename = `${h.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "harness"}.harness.json`;
      res.json({ ...out, filename });
    } catch (e) {
      bad(res, e);
    }
  });

  async function filesFrom(b: Record<string, unknown>): Promise<{ files: BundleFile[]; origin: HarnessOrigin; skipped: string[] }> {
    if (b.github && typeof b.github === "object") {
      const g = b.github as Record<string, unknown>;
      const str = (k: string) => (typeof g[k] === "string" ? (g[k] as string).trim() : "");
      const owner = str("owner");
      const repo = str("repo");
      const token = await resolveSkillRepoToken(c.cfg, owner, repo);
      const r = await fetchRepoHarnessDir(owner, repo, str("branch") || undefined, str("path"), {
        maxFiles: HARNESS_LIMITS.maxBundleFiles,
        maxBytes: HARNESS_LIMITS.maxBundleBytes,
        maxFileBytes: HARNESS_LIMITS.maxBundleFileBytes,
      }, token);
      return { files: r.files, skipped: r.skipped, origin: { kind: "github", source: `${owner}/${repo}@${r.ref}${str("path") ? `:${str("path")}` : ""}`, at: Date.now() } };
    }
    return { files: parseBundleDocument(b.bundle), skipped: [], origin: { kind: "file", at: Date.now() } };
  }

  // Import, two steps: action "preview" shows exactly what would be stored (RULES.md, verify.sh,
  // egress, skills, notes); action "import" stores it with needsReview set.
  app.post("/harnesses/import.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = c.ownerOf(res);
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const { files, origin, skipped } = await filesFrom(b);
      const parsed = parseHarnessFolder(files);
      const store = await c.loadSkills();
      const plan = planImport(parsed, { store, providers: loadProviders(owner), origin });
      const notes = [...skipped.map((s) => `Not imported: ${s}`), ...plan.notes];
      if (b.action === "preview") {
        res.json({
          preview: {
            harness: plan.harness,
            skills: plan.addSkills.map((s) => ({ name: s.name, description: s.description, files: (s.files ?? []).length })),
            notes,
          },
        });
        return;
      }
      if (b.action !== "import") return void res.status(400).json({ error: "unknown action" });
      if (loadHarnesses(owner).length >= HARNESS_LIMITS.maxHarnesses) throw new Error(`At most ${HARNESS_LIMITS.maxHarnesses} saved harnesses.`);
      if (plan.addSkills.length) await c.addSkills(plan.addSkills);
      putHarness(plan.harness, owner);
      res.json({ ...payload(owner), saved: plan.harness.id, notes });
    } catch (e) {
      bad(res, e);
    }
  });

  // Compare: create the link, then the page starts both sides through /delegate.json with
  // {harness, compareId, compareSide}. Both harnesses must be the caller's and reviewed.
  app.post("/harness-compares.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = c.ownerOf(res);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const task = typeof b.task === "string" ? b.task.trim() : "";
    if (!task) return void res.status(400).json({ error: "task is required" });
    const a = typeof b.harnessA === "string" ? getHarness(b.harnessA, owner) : undefined;
    const z = typeof b.harnessB === "string" ? getHarness(b.harnessB, owner) : undefined;
    if (!a || !z) return void res.status(400).json({ error: "Pick two saved harnesses." });
    if (a.id === z.id) return void res.status(400).json({ error: "Pick two different harnesses." });
    const unreviewed = [a, z].find((h) => h.needsReview);
    if (unreviewed) return void res.status(400).json({ error: `Harness "${unreviewed.name}" needs review before it can run.` });
    res.json({ id: createCompare(c.db, owner, { task, harnessA: a.id, harnessB: z.id }) });
  });

  app.get("/harness-compares.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = c.ownerOf(res);
    if (typeof req.query.id !== "string") {
      res.json({ compares: listCompares(c.db, owner) });
      return;
    }
    const cmp = getCompare(c.db, owner, req.query.id);
    if (!cmp) return void res.status(404).json({ error: "No such compare." });
    try {
      const names = Object.fromEntries(loadHarnesses(owner).map((h) => [h.id, h.name]));
      const sides = await Promise.all(
        (["a", "b"] as const).map(async (side) => {
          const harnessId = side === "a" ? cmp.harnessA : cmp.harnessB;
          const link = cmp.sides.find((s) => s.side === side);
          const base = { side, harnessId, harnessName: link?.harnessName ?? names[harnessId] ?? harnessId };
          if (!link) return { ...base, box: null, facts: null, source: "not-started" as const };
          // Archived record first (a finished run is a record); otherwise the live box.
          const archived = archivedDigestOf(c.db, owner, link.box);
          const digest = archived ?? (await c.liveDigest(link.box).catch(() => null));
          if (!digest) return { ...base, box: link.box, facts: null, source: "gone" as const };
          const cost = (digest as { cost?: { usd?: unknown } }).cost?.usd;
          return {
            ...base,
            box: link.box,
            source: archived ? ("archive" as const) : ("live" as const),
            facts: compareFacts(digest as unknown as Parameters<typeof compareFacts>[0], typeof cost === "number" ? cost : null),
          };
        })
      );
      res.json({ id: cmp.id, task: cmp.task, createdAt: cmp.createdAt, sides });
    } catch (e) {
      bad(res, e, 500);
    }
  });
}
