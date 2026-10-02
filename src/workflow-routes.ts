import type { Express, Request, Response } from "express";
import type { Config } from "./config.js";
import { fetchRepoWorkflowFiles, resolveSkillRepoToken } from "./github-skills.js";
import {
  WORKFLOW_FILE_DIR,
  WORKFLOW_LIMITS,
  deleteWorkflow,
  getWorkflow,
  loadWorkflows,
  putWorkflow,
  upsertWorkflow,
  workflowFromYaml,
  workflowToYaml,
  type WorkflowDef,
} from "./workflow.js";

/**
 * HTTP surface for workflows (src/workflow.ts): list, upsert (a form object or YAML text), delete,
 * and import from a repository's `.agent-sandbox/workflows/` folder. Same auth as every settings
 * route; the owner is the caller, never a parameter.
 */
export interface WorkflowRouteCtx {
  cfg: Config;
  dashAuthed(req: Request, res: Response): boolean;
  ownerOf(res: Response): string;
  clientError(e: unknown): string;
}

export function registerWorkflowRoutes(app: Express, c: WorkflowRouteCtx): void {
  const payload = (owner: string) => ({ workflows: loadWorkflows(owner), limits: WORKFLOW_LIMITS, dir: WORKFLOW_FILE_DIR });
  const bad = (res: Response, e: unknown, status = 400) => res.status(status).json({ error: c.clientError(e) });

  app.get("/workflows.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    res.json(payload(c.ownerOf(res)));
  });

  /** The YAML form of one saved workflow — what the page's editor shows and what a repo file would contain. */
  app.get("/workflows/yaml.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const w = typeof req.query.id === "string" ? getWorkflow(req.query.id, c.ownerOf(res)) : undefined;
    if (!w) return void res.status(404).json({ error: "No such workflow." });
    res.json({ id: w.id, yaml: workflowToYaml(w), filename: `${WORKFLOW_FILE_DIR}/${w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workflow"}.yaml` });
  });

  app.post("/workflows.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = c.ownerOf(res);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : undefined;
    try {
      let saved: string | undefined;
      let imported: string[] | undefined;
      let skipped: string[] | undefined;
      if (b.action === "upsert") {
        // Either a structured form or YAML text; the YAML is parsed on the server so the page and a
        // repo file share one reader.
        const input = typeof b.yaml === "string" ? (workflowFromYaml(b.yaml) as unknown as Record<string, unknown>) : ((b.workflow ?? {}) as Record<string, unknown>);
        saved = upsertWorkflow(input, id, owner).id;
      } else if (b.action === "delete") {
        if (!id || !deleteWorkflow(id, owner)) return void res.status(404).json({ error: "No such workflow." });
      } else if (b.action === "preview") {
        // Parse without saving: the editor's live validation.
        if (typeof b.yaml !== "string") throw new Error("yaml is required.");
        const w = workflowFromYaml(b.yaml);
        return void res.json({ ok: true, workflow: w });
      } else if (b.action === "import-repo") {
        const repo = typeof b.repo === "string" ? b.repo.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "") : "";
        const m = /^([\w.-]+)\/([\w.-]+)$/.exec(repo);
        if (!m) throw new Error("Enter a repository as owner/repo.");
        const ref = typeof b.ref === "string" && b.ref.trim() ? b.ref.trim() : undefined;
        const token = await resolveSkillRepoToken(c.cfg, m[1], m[2]);
        const r = await fetchRepoWorkflowFiles(m[1], m[2], ref, WORKFLOW_FILE_DIR, WORKFLOW_LIMITS.maxYamlBytes, token);
        if (!r.files.length && !r.skipped.length) throw new Error(`No workflow files under ${WORKFLOW_FILE_DIR}/ in ${repo}.`);
        imported = [];
        skipped = [...r.skipped];
        for (const f of r.files) {
          const fallback = f.path.replace(/^.*\//, "").replace(/\.ya?ml$/i, "");
          try {
            const def: WorkflowDef = workflowFromYaml(f.content, fallback, { kind: "repo", repo, path: f.path, ref: r.ref });
            imported.push(putWorkflow(def, owner).name);
          } catch (e) {
            skipped.push(`${f.path}: ${c.clientError(e)}`);
          }
        }
      } else {
        return void res.status(400).json({ error: "unknown action" });
      }
      res.json({ ...payload(owner), ...(saved ? { saved } : {}), ...(imported ? { imported } : {}), ...(skipped ? { skipped } : {}) });
    } catch (e) {
      bad(res, e);
    }
  });
}
