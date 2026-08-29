import * as React from "react";
import { ArrowLeft, ArrowRight, Check, Copy, KeyRound, Loader2, PlugZap, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { api, type Me } from "@/lib/api";
import { getMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Connect your IDE": the moment after sign-up, and any time later from Account. One key, shown once,
 * already pasted into the config for each client; a live "Test connection" proves it works before
 * the person leaves the page.
 */
const CLIENTS = [
  { id: "claude", label: "Claude Code", how: "Run in a terminal:", snippet: (u: string, k: string) => `claude mcp add --transport http agent-sandbox ${u} --header "Authorization: Bearer ${k}"` },
  { id: "cursor", label: "Cursor", how: "~/.cursor/mcp.json (or the project's .cursor/mcp.json):", snippet: (u: string, k: string) => JSON.stringify({ mcpServers: { "agent-sandbox": { url: u, headers: { Authorization: `Bearer ${k}` } } } }, null, 2) },
  { id: "vscode", label: "VS Code", how: ".vscode/mcp.json:", snippet: (u: string, k: string) => JSON.stringify({ servers: { "agent-sandbox": { type: "http", url: u, headers: { Authorization: `Bearer ${k}` } } } }, null, 2) },
  { id: "windsurf", label: "Windsurf", how: "~/.codeium/windsurf/mcp_config.json:", snippet: (u: string, k: string) => JSON.stringify({ mcpServers: { "agent-sandbox": { serverUrl: u, headers: { Authorization: `Bearer ${k}` } } } }, null, 2) },
  { id: "curl", label: "Any client / CI", how: "Plain HTTP with a bearer:", snippet: (u: string, k: string) => `curl -H "Authorization: Bearer ${k}" ${u.replace(/\/mcp$/, "")}/fleet.json` },
];

export function Connect({ onDone, onBack, welcome = false }: { onDone: () => void; onBack: () => void; welcome?: boolean }) {
  const me = getMe();
  const mcpUrl = `${location.origin}/mcp`;
  const [key, setKey] = React.useState<string | null>(null);
  const [minting, setMinting] = React.useState(false);
  const [client, setClient] = React.useState(CLIENTS[0].id);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [test, setTest] = React.useState<{ state: "idle" | "busy" | "ok" | "fail"; who?: Me | null }>({ state: "idle" });
  const auto = React.useRef(false);

  const mint = React.useCallback(async () => {
    if (minting) return;
    setMinting(true);
    try {
      const k = await api.createApiKey(`${CLIENTS.find((c) => c.id === client)?.label ?? "IDE"} · ${new Date().toLocaleDateString()}`);
      setKey(k.token);
      setTest({ state: "idle" });
    } catch (e) {
      toast.error("Could not create a key", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setMinting(false);
    }
  }, [client, minting]);
  // Fresh sign-up: mint the first key without a click.
  React.useEffect(() => {
    if (welcome && !auto.current && me?.kind === "user") {
      auto.current = true;
      void mint();
    }
  }, [welcome, me, mint]);

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error("Could not copy — select the text and copy it manually");
    }
  };
  const runTest = async () => {
    if (!key) return;
    setTest({ state: "busy" });
    const who = await api.whoIs(key).catch(() => null);
    setTest({ state: who ? "ok" : "fail", who });
  };
  const c = CLIENTS.find((x) => x.id === client)!;
  const snippet = c.snippet(mcpUrl, key ?? "asb_…your key…");

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-12">
        {!welcome && (
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-4">
            <ArrowLeft className="size-4" />
            Account
          </Button>
        )}
        <header className="mb-8">
          {welcome && <p className="label text-live mb-2">Welcome{me?.kind === "user" && me.name ? `, ${me.name.split(" ")[0]}` : ""}</p>}
          <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Connect your IDE</h1>
          <p className="text-muted-foreground mt-1 text-body leading-relaxed">Your editor delegates tasks to machines through the MCP endpoint. This key identifies you; every machine it starts is yours alone.</p>
        </header>

        {/* 1 — the key */}
        <Step n={1} title="Your API key" done={!!key}>
          {key ? (
            <>
              <div className="flex items-center gap-2">
                <code className="bg-muted text-foreground min-w-0 flex-1 truncate rounded-md px-2.5 py-2 font-mono text-code select-all">{key}</code>
                <Button size="sm" variant="outline" onClick={() => copy("key", key)}>
                  {copied === "key" ? <Check className="text-ok" /> : <Copy />}
                  {copied === "key" ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-muted-foreground mt-2 text-micro">Shown once. It is already filled into the config below. Revoke it any time from Account.</p>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Button onClick={mint} disabled={minting}>
                {minting ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {minting ? "Creating…" : "Create a key"}
              </Button>
              <span className="text-muted-foreground text-meta">One key per IDE is a good habit — revoke one without touching the others.</span>
            </div>
          )}
        </Step>

        {/* 2 — the config */}
        <Step n={2} title="Add the server to your editor" done={copied === "snippet"}>
          <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Client">
            {CLIENTS.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={client === x.id}
                onClick={() => setClient(x.id)}
                className={cn("h-8 cursor-pointer rounded-md px-3 text-meta transition-colors", client === x.id ? "bg-accent text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
              >
                {x.label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground mb-2 text-meta">{c.how}</p>
          <div className="relative">
            <pre className={cn("bg-card raised overflow-x-auto rounded-xl p-4 font-mono text-code leading-relaxed", !key && "text-muted-foreground")}>{snippet}</pre>
            <Button size="sm" variant="outline" className="absolute top-2.5 right-2.5" onClick={() => copy("snippet", snippet)} disabled={!key}>
              {copied === "snippet" ? <Check className="text-ok" /> : <Copy />}
              {copied === "snippet" ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-faint mt-2 text-micro">
            Endpoint <code className="font-mono">{mcpUrl}</code> · header <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>
          </p>
        </Step>

        {/* 3 — prove it */}
        <Step n={3} title="Test the connection" done={test.state === "ok"} last>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={runTest} disabled={!key || test.state === "busy"}>
              {test.state === "busy" ? <Loader2 className="animate-spin" /> : test.state === "ok" ? <Check className="text-ok" /> : <PlugZap />}
              {test.state === "busy" ? "Testing…" : test.state === "ok" ? "Connected" : "Test connection"}
            </Button>
            {test.state === "ok" && test.who?.kind === "user" && (
              <span className="text-ok text-meta">
                The controller recognises this key as <span className="font-medium">{test.who.login}</span>. Your IDE will too.
              </span>
            )}
            {test.state === "fail" && (
              <span className="text-destructive flex items-center gap-2 text-meta">
                The key was refused.
                <button type="button" className="inline-flex cursor-pointer items-center gap-1 underline underline-offset-4" onClick={mint}>
                  <RotateCw className="size-3" /> Make a new one
                </button>
              </span>
            )}
          </div>
        </Step>

        <div className="mt-10 flex items-center gap-3">
          <Button size="lg" onClick={onDone}>
            {welcome ? "Go to the dashboard" : "Done"}
            <ArrowRight className="size-4" />
          </Button>
          {welcome && <span className="text-muted-foreground text-meta">You can come back here from Account → Connect an IDE.</span>}
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, done, last = false, children }: { n: number; title: string; done: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <section className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-micro font-semibold transition-colors", done ? "bg-ok text-white" : "bg-muted text-muted-foreground")}>{done ? <Check className="size-3.5" /> : n}</span>
        {!last && <span className="bg-border my-2 w-px flex-1" aria-hidden />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-8")}>
        <h2 className="text-foreground mb-3 text-h3 font-semibold tracking-[-0.01em]">{title}</h2>
        {children}
      </div>
    </section>
  );
}
