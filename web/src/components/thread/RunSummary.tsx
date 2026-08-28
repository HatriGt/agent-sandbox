import * as React from "react";
import { Check, Copy, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { RunStats } from "@/lib/transcript";
import { fmtDuration } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

/**
 * The last line of a finished run. Reads like a sentence, not a spec sheet: "Completed · 14 steps ·
 * 4 files · 6 commands · 19m", then two tertiary actions for what you usually do next — copy the
 * record, or start a fresh task from this one.
 */
export function RunSummary({
  label,
  detail,
  stats,
  durationSec,
  failed,
  onCopy,
  onAgain,
}: {
  label: string;
  detail?: string;
  stats: RunStats;
  durationSec?: number;
  failed?: boolean;
  onCopy: () => Promise<string>;
  onAgain: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const parts = [
    stats.steps ? `${stats.steps} ${stats.steps === 1 ? "step" : "steps"}` : null,
    stats.files ? `${stats.files} ${stats.files === 1 ? "file" : "files"}` : null,
    stats.commands ? `${stats.commands} ${stats.commands === 1 ? "command" : "commands"}` : null,
    stats.failed ? `${stats.failed} failed` : null,
    durationSec && durationSec > 0 ? fmtDuration(durationSec) : null,
  ].filter(Boolean) as string[];

  const copy = async () => {
    try {
      const md = await onCopy();
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      toast.error("Could not copy", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="enter flex flex-wrap items-center gap-x-3 gap-y-1.5 py-0.5">
      <span className={cn("label shrink-0", failed ? "text-destructive" : "text-muted-foreground")}>{label}</span>
      {(parts.length > 0 || detail) && (
        <span className="text-faint truncate text-micro">{[...parts, detail].filter(Boolean).join(" · ")}</span>
      )}
      <span className="bg-border h-px min-w-6 flex-1" aria-hidden />
      <span className="flex shrink-0 items-center gap-1">
        <Tertiary onClick={copy} icon={copied ? <Check className="text-ok" /> : <Copy />} label={copied ? "Copied" : "Copy transcript"} />
        <Tertiary onClick={onAgain} icon={<RotateCw />} label="New task from this" />
      </span>
    </div>
  );
}

function Tertiary({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-micro font-medium transition-colors [&_svg]:size-3.5"
    >
      {icon}
      {label}
    </button>
  );
}
