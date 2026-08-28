import * as React from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ApiKeyRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Personal API keys — what an IDE (Cursor, Claude Code…) or a CI job presents to /mcp and the JSON
 * routes as `Authorization: Bearer asb_…`. Shown once at creation; the server keeps only a hash.
 */
export function ApiKeys() {
  const [keys, setKeys] = React.useState<ApiKeyRow[] | null>(null);
  const [name, setName] = React.useState("");
  const [fresh, setFresh] = React.useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const load = React.useCallback(() => api.apiKeys().then((r) => setKeys(r.keys)).catch(() => setKeys([])), []);
  React.useEffect(() => void load(), [load]);

  const create = async () => {
    try {
      const k = await api.createApiKey(name.trim() || "key");
      setFresh({ token: k.token, name: name.trim() || "key" });
      setName("");
      void load();
    } catch (e) {
      toast.error("Could not create the key", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const revoke = async (k: ApiKeyRow) => {
    try {
      await api.revokeApiKey(k.id);
      toast.success(`Revoked ${k.name}`);
      void load();
    } catch (e) {
      toast.error("Could not revoke", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy — select the key and copy it manually");
    }
  };
  const active = (keys ?? []).filter((k) => !k.revoked_at);

  return (
    <section aria-labelledby="keys-h">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="keys-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          API keys
        </h2>
        <span className="text-muted-foreground text-meta">for Cursor, Claude Code, CI — the MCP endpoint</span>
      </div>

      {fresh && (
        <div className="bg-card raised mb-3 rounded-xl p-4">
          <p className="text-foreground text-meta font-medium">Copy your new key now — it will not be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="bg-muted text-foreground min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 font-mono text-code select-all">{fresh.token}</code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="text-ok" /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
          <p className="text-muted-foreground mt-2 text-micro">
            MCP: <code className="font-mono">https://{location.host}/mcp</code> with header <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>
          </p>
        </div>
      )}

      <ul className="divide-y rounded-xl border">
        {keys === null && <li className="text-muted-foreground px-3.5 py-3 text-meta">Loading…</li>}
        {keys !== null && active.length === 0 && <li className="text-muted-foreground px-3.5 py-4 text-meta">No keys yet. Create one to connect an IDE or a script.</li>}
        {active.map((k) => (
          <li key={k.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <KeyRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">{k.name}</span>
            <span className="stamp text-muted-foreground shrink-0">{k.prefix}…</span>
            <span className="text-faint hidden shrink-0 text-micro sm:inline">{k.last_used_at ? `used ${fmtAgo(Date.parse(k.last_used_at) / 1000)}` : "never used"}</span>
            <Button size="icon-sm" variant="ghost" aria-label={`Revoke ${k.name}`} onClick={() => revoke(k)} className="text-muted-foreground hover:text-destructive">
              <Trash2 />
            </Button>
          </li>
        ))}
        <li className="flex items-center gap-2 px-3.5 py-2.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Name this key — e.g. Cursor on laptop"
            aria-label="Key name"
            className={cn("placeholder:text-muted-foreground text-foreground h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-meta outline-none")}
          />
          <Button size="sm" variant="outline" onClick={create}>
            <Plus />
            New key
          </Button>
        </li>
      </ul>
    </section>
  );
}
