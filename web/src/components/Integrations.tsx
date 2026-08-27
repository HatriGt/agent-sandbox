import * as React from "react";
import { ArrowLeft, Github, Plug, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accounts } from "@/components/Accounts";
import { McpServers, type McpFilter } from "@/components/McpServers";
import { cn } from "@/lib/utils";

/**
 * Integrations, laid out like a settings surface rather than a marketing page: a compact header with
 * one search field that filters everything below, a sticky sub-nav on the left (with live counts),
 * and two dense tables — GitHub accounts and MCP servers — on the right. Every row is a thing you can
 * act on inline (default, on/off, edit, remove); nothing explains itself in paragraphs.
 */
export function Integrations({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<McpFilter>("all");
  const [counts, setCounts] = React.useState<{ accounts?: number; servers?: number; enabled?: number }>({});
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
          <ArrowLeft className="size-4" />
          Machines
        </Button>

        <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Integrations</h1>
            <p className="text-muted-foreground mt-0.5 text-meta">Accounts and tools every sandbox gets. Stored on your server.</p>
          </div>
          <label className="bg-card focus-within:ring-ring relative flex h-9 w-full items-center gap-2 rounded-lg border px-3 transition-shadow focus-within:ring-2 md:w-72">
            <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accounts, servers…"
              className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none"
              aria-label="Search integrations"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded">
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 font-mono text-micro">/</kbd>
            )}
          </label>
        </header>

        <div className="mt-6 grid gap-8 md:grid-cols-[180px_1fr]">
          <nav aria-label="Sections" className="hidden md:block">
            <ul className="sticky top-2 flex flex-col gap-0.5">
              <NavItem href="#accounts" icon={<Github className="size-3.5" />} label="GitHub accounts" count={counts.accounts} />
              <NavItem href="#mcp" icon={<Plug className="size-3.5" />} label="MCP servers" count={counts.servers} hint={counts.enabled != null && counts.servers ? `${counts.enabled} on` : undefined} />
            </ul>
          </nav>

          <div className="flex min-w-0 flex-col gap-10">
            <section id="accounts" aria-labelledby="accounts-h" className="scroll-mt-4">
              <SectionHead id="accounts-h" title="GitHub accounts" line="Used to clone, read pull requests and push. The default account covers runs with no repository." />
              <Accounts embedded query={query} onCount={(n) => setCounts((c) => (c.accounts === n ? c : { ...c, accounts: n }))} />
            </section>
            <section id="mcp" aria-labelledby="mcp-h" className="scroll-mt-4">
              <SectionHead id="mcp-h" title="MCP servers" line="Tools handed to the agent inside every sandbox on its next run or turn.">
                <div role="radiogroup" aria-label="Filter servers" className="bg-muted inline-flex h-8 items-center gap-0.5 rounded-lg p-0.5">
                  {(
                    [
                      ["all", "All"],
                      ["enabled", "On"],
                      ["disabled", "Off"],
                      ["stdio", "stdio"],
                      ["remote", "Remote"],
                    ] as [McpFilter, string][]
                  ).map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={cn("h-7 cursor-pointer rounded-md px-2.5 text-micro font-medium transition-colors", filter === k ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                      {l}
                    </button>
                  ))}
                </div>
              </SectionHead>
              <McpServers query={query} filter={filter} onCount={(total, enabled) => setCounts((c) => (c.servers === total && c.enabled === enabled ? c : { ...c, servers: total, enabled }))} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavItem({ href, icon, label, count, hint }: { href: string; icon: React.ReactNode; label: string; count?: number; hint?: string }) {
  return (
    <li>
      <a href={href} className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 items-center gap-2 rounded-md px-2 text-meta transition-colors">
        {icon}
        <span className="flex-1">{label}</span>
        {count != null && (
          <span className="stamp text-muted-foreground">
            {count}
            {hint && <span className="opacity-60"> · {hint}</span>}
          </span>
        )}
      </a>
    </li>
  );
}

function SectionHead({ id, title, line, children }: { id: string; title: string; line: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id={id} className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        <p className="text-muted-foreground text-meta">{line}</p>
      </div>
      {children}
    </div>
  );
}
