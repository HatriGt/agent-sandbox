import * as React from "react";
import { FileUp, Github } from "lucide-react";
import { toast } from "sonner";
import { api, type HarnessImportPreview, type HarnessesResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Panel, PanelFooter } from "@/components/ui/settings";
import { Segmented } from "@/components/ui/segmented";
import { rulesLine } from "@/components/harness/model";

type Source = { bundle: unknown } | { github: { owner: string; repo: string; branch?: string; path?: string } };

/**
 * Import a bundle (an exported file, or a folder in a GitHub repo — fetched by the controller, the
 * page's CSP is connect-src 'self'). Two steps: the preview shows exactly what gets stored; the
 * stored harness is still marked "needs review" and cannot run until approved.
 */
export function ImportHarness({ onCancel, onImported }: { onCancel: () => void; onImported: (r: HarnessesResponse) => void }) {
  const [mode, setMode] = React.useState<"file" | "github">("file");
  const [gh, setGh] = React.useState("");
  const [source, setSource] = React.useState<Source | null>(null);
  const [preview, setPreview] = React.useState<HarnessImportPreview["preview"] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async (src: Source) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.harnessImport<HarnessImportPreview>({ action: "preview", ...src });
      setSource(src);
      setPreview(r.preview);
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 3_500_000) return setError("That file is over the 3 MB bundle limit.");
    try {
      await run({ bundle: JSON.parse(await f.text()) });
    } catch {
      setError("That file is not a harness bundle (JSON).");
    }
  };

  const parseGh = (): Source | null => {
    // owner/repo[/path][@branch] or a github.com URL to a tree.
    const s = gh.trim().replace(/^https?:\/\/github\.com\//, "");
    const url = s.match(/^([\w.-]+)\/([\w.-]+)\/tree\/([^/]+)\/?(.*)$/);
    if (url) return { github: { owner: url[1], repo: url[2], branch: url[3], path: url[4] } };
    const m = s.match(/^([\w.-]+)\/([\w.-]+)(\/[^@]*)?(?:@(.+))?$/);
    if (!m) return null;
    return { github: { owner: m[1], repo: m[2].replace(/\.git$/, ""), ...(m[3] ? { path: m[3].replace(/^\/|\/$/g, "") } : {}), ...(m[4] ? { branch: m[4] } : {}) } };
  };

  const confirm = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const r = await api.harnessImport<HarnessesResponse & { notes: string[] }>({ action: "import", ...source });
      toast.success("Imported — review it before it can run");
      onImported(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const h = preview?.harness;
  return (
    <Panel>
      <div className="flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-foreground text-h3 font-semibold">Import a harness</h2>
          <Segmented
            ariaLabel="Import source"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setPreview(null);
              setError(null);
            }}
            options={[
              { value: "file", label: "File" },
              { value: "github", label: "GitHub" },
            ]}
          />
        </div>
        {mode === "file" ? (
          <label className="hover:bg-muted/50 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors">
            <FileUp className="text-muted-foreground size-5" />
            <span className="text-foreground text-meta">Choose an exported .harness.json</span>
            <span className="text-faint text-micro">Checked for version, size and anything shaped like a secret.</span>
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
        ) : (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const src = parseGh();
              if (!src) return setError("Use owner/repo/path, optionally @branch.");
              void run(src);
            }}
          >
            <Field label="Folder" hint="A folder with harness.json, RULES.md, verify.sh and skills/." className="flex-1">
              {(w) => <Input {...w} mono value={gh} onChange={(e) => setGh(e.target.value)} placeholder="acme/harnesses/careful@main" />}
            </Field>
            <Button type="submit" variant="outline" size="default" disabled={busy || !gh.trim()} className="sm:mb-[1.4rem]">
              <Github className="size-4" />
              Fetch
            </Button>
          </form>
        )}
        {error && <p role="alert" className="text-destructive text-meta">{error}</p>}
        {h && preview && (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-foreground text-body font-medium">{h.name}</span>
              <span className="text-muted-foreground text-micro">{[h.driver, h.model, rulesLine(h.rules)].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="label text-muted-foreground">verify.sh</span>
              {h.verifyCommand ? <pre className="bg-muted overflow-x-auto rounded p-2 font-mono text-micro whitespace-pre-wrap">{h.verifyCommand}</pre> : <span className="text-faint text-micro">none</span>}
            </div>
            <div className="flex flex-col gap-1">
              <span className="label text-muted-foreground">Egress</span>
              <span className="font-mono text-micro">{h.egress?.length ? h.egress.join(", ") : "defaults only"}</span>
            </div>
            {h.rulesMd && (
              <div className="flex flex-col gap-1">
                <span className="label text-muted-foreground">RULES.md</span>
                <pre className="bg-muted max-h-40 overflow-auto rounded p-2 font-mono text-micro whitespace-pre-wrap">{h.rulesMd}</pre>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="label text-muted-foreground">Skills added (disabled in your library)</span>
              <span className="text-micro">{preview.skills.length ? preview.skills.map((s) => s.name).join(", ") : "none"}</span>
            </div>
            {preview.notes.length > 0 && (
              <ul className="text-attention flex list-disc flex-col gap-0.5 pl-4 text-micro">
                {preview.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <PanelFooter className="justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void confirm()} disabled={!preview || busy}>
          Import for review
        </Button>
      </PanelFooter>
    </Panel>
  );
}
