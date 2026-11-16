import * as React from "react";
import { Building2, ChevronRight } from "lucide-react";
import type { OrgRef } from "@/lib/api";
import { useGo } from "@/lib/route";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/settings";
import { StatusDot } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

export interface SharedItem {
  key: string;
  name: React.ReactNode;
  /** A second line in the row's quiet ink: a URL, a command, a description. */
  detail?: string;
  /** A short word set in a wash chip: "command", "http", a note kind. */
  kind?: string;
  /** Whether the organisation has it on; off items are listed dimmer so a member sees why a tool is missing. */
  on?: boolean;
  /** Draw this instead of the default glyph circle. */
  glyph?: React.ReactNode;
}

/**
 * What an organisation shares with the person looking: one group per org under their own list on
 * the MCP, Skills and Memory pages. Read-only here — the org page is where it is edited, and an
 * admin gets the way there. The rows are plain tiles: nothing to click, nothing to toggle, so a
 * member cannot mistake an org's server for one of their own.
 */
export function SharedBy({ org, kind, items, className }: { org: OrgRef; kind: "servers" | "skills" | "notes"; items: SharedItem[]; className?: string }) {
  const go = useGo();
  const manage = org.role !== "member";
  const n = items.length;
  return (
    <section aria-label={`Shared by ${org.name}`} className={cn("mt-5 flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2.5 px-1">
        <span className="tile grid size-6 shrink-0 place-items-center rounded-full shadow-e1" aria-hidden>
          <Building2 className="text-muted-foreground size-3" strokeWidth={1.75} />
        </span>
        <span className="text-foreground min-w-0 truncate text-meta font-medium">Shared by {org.name}</span>
        <span className="text-muted-foreground text-meta tabular-nums">
          {n} {kind === "servers" ? (n === 1 ? "server" : "servers") : kind === "skills" ? (n === 1 ? "skill" : "skills") : n === 1 ? "note" : "notes"}
        </span>
        {manage && (
          <Button size="xs" variant="ghost" className="text-muted-foreground ml-auto" onClick={() => go({ view: "org", id: org.id })}>
            Manage
            <ChevronRight className="size-3.5" />
          </Button>
        )}
      </div>
      {n === 0 ? (
        <p className="text-muted-foreground px-1 text-meta">Nothing shared yet.</p>
      ) : (
        <Panel>
          <ul className="divide-y">
            {items.map((it) => (
              <li key={it.key} className={cn("flex min-w-0 items-center gap-3 px-3.5 py-2.5", it.on === false && "text-muted-foreground")}>
                {it.glyph}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("truncate text-meta font-medium", it.on === false ? "text-muted-foreground" : "text-foreground")}>{it.name}</span>
                  {it.detail && <span className={cn("truncate", kind === "notes" ? "text-muted-foreground text-micro" : "text-faint stamp")}>{it.detail}</span>}
                </span>
                {it.kind && <span className="bg-foreground/6 text-muted-foreground hidden shrink-0 rounded-full px-2 py-0.5 text-micro sm:inline">{it.kind}</span>}
                {it.on !== undefined && (
                  <StatusDot tone={it.on ? "live" : "muted"} className="shrink-0">
                    {it.on ? "on" : "off"}
                  </StatusDot>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  );
}
