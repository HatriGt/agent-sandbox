import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, KeyRound, PlugZap, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { api, type Me } from "@/lib/api";
import { getMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AnimatedTabs, TabPanel } from "@/components/ui/animated-tabs";
import { CopyButton } from "@/components/ApiKeys";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

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
] as const;
type ClientId = (typeof CLIENTS)[number]["id"];
const CLIENT_ORDER: readonly ClientId[] = CLIENTS.map((c) => c.id);

export function Connect({ onDone, onBack, welcome = false }: { onDone: () => void; onBack: () => void; welcome?: boolean }) {
  const me = getMe();
  const mcpUrl = `${location.origin}/mcp`;
  const [key, setKey] = React.useState<string | null>(null);
  const [minting, setMinting] = React.useState(false);
  const [client, setClient] = React.useState<ClientId>(CLIENTS[0].id);
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
  const still = useReducedMotion();

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
          <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em]">Connect your IDE</h1>
          <p className="text-muted-foreground mt-1 text-body leading-relaxed">Your editor delegates tasks to machines through the MCP endpoint. This key identifies you; every machine it starts is yours alone.</p>
        </header>

        {/* 1 — the key */}
        <Step n={1} title="Your API key" done={!!key}>
          <AnimatePresence mode="wait" initial={false}>
            {key ? (
              <motion.div
                key={key}
                initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              >
                <div className="flex items-center gap-2">
                  <code className="bg-muted text-foreground min-w-0 flex-1 truncate rounded-md px-2.5 py-2 font-mono text-code select-all">{key}</code>
                  <CopyButton copied={copied === "key"} onClick={() => void copy("key", key)} />
                </div>
                <p className="text-muted-foreground mt-2 text-micro">Shown once. It is already filled into the config below. Revoke it any time from Account.</p>
              </motion.div>
            ) : (
              <motion.div key="mint" initial={false} exit={{ opacity: 0, transition: { duration: 0.12 } }} className="flex items-center gap-3">
                <Button onClick={() => void mint()} loading={minting}>
                  <KeyRound />
                  {minting ? "Creating…" : "Create a key"}
                </Button>
                <span className="text-muted-foreground text-meta">One key per IDE is a good habit — revoke one without touching the others.</span>
              </motion.div>
            )}
          </AnimatePresence>
        </Step>

        {/* 2 — the config */}
        <Step n={2} title="Add the server to your editor" done={copied === "snippet"}>
          <AnimatedTabs
            ariaLabel="Client"
            idBase="connect-client"
            size="md"
            className="scrollbar-none mb-3 max-w-full overflow-x-auto"
            value={client}
            onChange={setClient}
            items={CLIENTS.map((x) => ({ value: x.id, label: x.label }))}
          />
          <TabPanel value={client} order={CLIENT_ORDER} idBase="connect-client">
            <p className="text-muted-foreground mb-2 text-meta">{c.how}</p>
            <div className="relative">
              <pre className={cn("bg-card raised overflow-x-auto rounded-xl p-4 pr-16 font-mono text-code leading-relaxed", !key && "text-muted-foreground")}>{snippet}</pre>
              <CopyButton className="bg-card absolute top-2.5 right-2.5 shadow-e1" copied={copied === "snippet"} onClick={() => void copy("snippet", snippet)} disabled={!key} />
            </div>
          </TabPanel>
          <p className="text-faint mt-2 text-micro">
            Endpoint <code className="font-mono">{mcpUrl}</code> · header <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>
          </p>
        </Step>

        {/* 3 — prove it */}
        <Step n={3} title="Test the connection" done={test.state === "ok"} last>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void runTest()} loading={test.state === "busy"} disabled={!key}>
              {test.state === "ok" ? <Check className="text-ok" /> : <PlugZap />}
              {test.state === "busy" ? "Testing…" : test.state === "ok" ? "Connected" : "Test connection"}
            </Button>
            <AnimatePresence mode="wait" initial={false}>
              {test.state === "ok" && test.who?.kind === "user" && (
                <ResultChip key="ok" tone="ok">
                  Recognised as <span className="font-medium">{test.who.login}</span> — your IDE will be too.
                </ResultChip>
              )}
              {test.state === "fail" && (
                <ResultChip key="fail" tone="destructive">
                  The key was refused.
                  <button type="button" className="inline-flex cursor-pointer items-center gap-1 underline underline-offset-4" onClick={() => void mint()}>
                    <RotateCw className="size-3" /> Make a new one
                  </button>
                </ResultChip>
              )}
            </AnimatePresence>
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

/** ok / destructive pill that springs in beside the test button. */
function ResultChip({ tone, children }: { tone: "ok" | "destructive"; children: React.ReactNode }) {
  const still = useReducedMotion();
  return (
    <motion.span
      role="status"
      initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.92, x: -6 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 520, damping: 30 }}
      className={cn("inline-flex flex-wrap items-center gap-2 rounded-full px-3 py-1.5 text-meta", tone === "ok" ? "bg-ok/10 text-ok" : "bg-destructive/10 text-destructive")}
    >
      {children}
    </motion.span>
  );
}

/**
 * Numbered step. When it completes, the --ok fill grows from the centre behind the badge and the
 * number crossfades to a tick — so "done" is a moment, not a colour change.
 */
function Step({ n, title, done, last = false, children }: { n: number; title: string; done: boolean; last?: boolean; children: React.ReactNode }) {
  const still = useReducedMotion();
  return (
    <section className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span className={cn("bg-muted relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-full text-micro font-semibold", done ? "text-white" : "text-muted-foreground")}>
          <motion.span aria-hidden className="bg-ok absolute inset-0 rounded-full" initial={false} animate={{ scale: done ? 1 : 0, opacity: done ? 1 : 0 }} transition={still ? { duration: 0.1 } : { type: "spring", stiffness: 500, damping: 30 }} />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={done ? "done" : "n"}
              className="relative inline-flex"
              initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.16, ease: EASE, delay: done && !still ? 0.08 : 0 }}
            >
              {done ? <Check className="size-3.5" /> : n}
            </motion.span>
          </AnimatePresence>
        </span>
        {!last && <span className="bg-border my-2 w-px flex-1" aria-hidden />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-8")}>
        <h2 className="text-foreground mb-3 text-h3 font-semibold tracking-[-0.01em]">{title}</h2>
        {children}
      </div>
    </section>
  );
}
