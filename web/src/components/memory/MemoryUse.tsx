import * as React from "react";
import { Trash2 } from "lucide-react";
import type { MemoryEpisode, MemoryNote, MemoryReceiptRow } from "@/lib/api";
import { fmtAgo, friendlyName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { plural } from "./kinds";

const DAY = 86_400_000;
const SHOWN = 5;

/**
 * Whether memory earns its keep: how many recent runs were handed notes, how many notes a run has
 * reached for, which ones none has, and what the last runs in each repo did. Every number is read
 * from the store; with nothing recorded yet the panel says what will fill it.
 */
export function MemoryUse({
  notes,
  episodes,
  receipts,
  onForgetEpisode,
  onOpenRun,
}: {
  notes: MemoryNote[];
  episodes: MemoryEpisode[];
  receipts: MemoryReceiptRow[];
  onForgetEpisode: (box: string) => void;
  onOpenRun?: (box: string) => void;
}) {
  const [all, setAll] = React.useState(false);
  const now = Date.now();
  const live = notes.filter((n) => n.until == null && n.status === "kept");
  const recalled = live.filter((n) => (n.uses ?? 0) > 0);
  const idle = live.filter((n) => !n.pinned && n.kind !== "preference" && n.kind !== "rule" && !(n.uses ?? 0) && now - n.at > 30 * DAY);
  const recent = receipts.filter((r) => now - r.at < 30 * DAY);
  const withNotes = recent.filter((r) => r.picked > 0 || r.core > 0);
  const last = receipts[0];
  const shown = all ? episodes : episodes.slice(0, SHOWN);

  return (
    <section aria-labelledby="memory-use-title" className="bg-card grid gap-x-8 gap-y-4 rounded-xl border px-4 py-3.5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="memory-use-title" className="text-foreground text-body font-medium">
          In use
        </h2>
        <dl className="mt-2 flex flex-col gap-2 text-meta">
          <Stat label="Runs handed memory, 30 days" value={recent.length ? `${withNotes.length} of ${recent.length}` : "none yet"} hint={last ? `last ${fmtAgo(Math.floor(last.at / 1000))}` : undefined} />
          <Stat label="Notes a run has reached for" value={live.length ? `${recalled.length} of ${live.length}` : "none yet"} />
          <Stat
            label="Not reached for in 30 days"
            value={idle.length ? plural(idle.length, "note") : "none"}
            hint={idle.length ? "first to go when a kind is full" : undefined}
            tone={idle.length > live.length / 2 && live.length > 5 ? "warn" : undefined}
          />
        </dl>
      </div>

      <div className="min-w-0">
        <h3 className="text-foreground text-body font-medium">
          Recent work <span className="text-muted-foreground font-normal tabular-nums">{episodes.length > 0 && `· ${episodes.length}`}</span>
        </h3>
        {episodes.length === 0 ? (
          <p className="text-muted-foreground mt-2 max-w-prose text-meta">
            When a run in a repo finishes, what it was asked and how it ended is kept here and handed to the next run in that repo.
          </p>
        ) : (
          <>
            <ul className="mt-1.5 flex flex-col">
              {shown.map((e) => (
                <li key={`${e.repo}:${e.box}`} className="group/ep flex items-start gap-2.5 border-t py-2 first:border-t-0">
                  <span className={cn("stamp mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-micro", e.state === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{e.state}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-meta" title={e.task}>
                      {onOpenRun ? (
                        <button type="button" onClick={() => onOpenRun(e.box)} className="focus-visible:ring-ring max-w-full truncate rounded-sm text-left underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none">
                          {e.task}
                        </button>
                      ) : (
                        e.task
                      )}
                    </p>
                    {e.summary && <p className="text-muted-foreground line-clamp-2 text-micro">{e.summary}</p>}
                    <p className="text-faint text-micro">
                      {[e.repo, fmtAgo(Math.floor(e.at / 1000)), friendlyName(e.box), e.turns > 1 && `${e.turns} turns`, e.files?.length && plural(e.files.length, "file")].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onForgetEpisode(e.box)}
                    aria-label={`Forget this run: ${e.task}`}
                    title="Forget this run"
                    className="text-faint hover:text-destructive focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md opacity-0 group-hover/ep:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none [@media(hover:none)]:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            {episodes.length > SHOWN && (
              <button type="button" onClick={() => setAll((v) => !v)} className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-1 rounded-sm text-micro underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none">
                {all ? "Show fewer" : `Show all ${episodes.length}`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div>
      <dt className="text-muted-foreground text-micro">{label}</dt>
      <dd className={cn("text-foreground tabular-nums", tone === "warn" && "text-attention-text")}>
        {value}
        {hint && <span className="text-faint text-micro"> ({hint})</span>}
      </dd>
    </div>
  );
}
