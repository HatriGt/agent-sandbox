import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cleanLog, logTone, type LogTone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<LogTone, string> = {
  err: "text-red-400",
  warn: "text-amber-300",
  ok: "text-emerald-300",
  cmd: "text-indigo-300 font-medium",
  tool: "text-sky-300",
  question: "text-amber-200",
  plain: "",
};

/**
 * The driver's own output. Deliberately the one dark surface in both themes: the agent's log is code
 * and tool traffic, and the colour vocabulary it emits is authored for a dark ground.
 *
 * Follows the tail while the reader is at the bottom and stops the moment they scroll up, so a 3s
 * poll can't yank them out of a line they're reading.
 */
export function LogTerminal({ name, log }: { name: string; log: string }) {
  const preRef = React.useRef<HTMLPreElement>(null);
  const pinnedRef = React.useRef(true);
  const [copied, setCopied] = React.useState(false);

  const lines = React.useMemo(() => cleanLog(log).split("\n"), [log]);

  const onScroll = () => {
    const el = preRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  React.useEffect(() => {
    const el = preRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const copy = async () => {
    await navigator.clipboard?.writeText(cleanLog(log));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="bg-terminal border-terminal-border overflow-hidden rounded-lg border">
      <div className="border-terminal-border bg-black/25 flex items-center gap-2 border-b px-3 py-2">
        <span className="text-terminal-foreground/55 font-mono text-xs font-medium truncate">{name}</span>
        <span className="text-terminal-foreground/40 ml-auto flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
          <span className="bg-live size-1.5 rounded-full" />
          live
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={copy}
          className="text-terminal-foreground/55 hover:text-terminal-foreground hover:bg-white/10 h-7 px-2 text-[11px]"
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        ref={preRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label={`Live log for ${name}`}
        className="text-terminal-foreground max-h-[45vh] min-h-32 overflow-auto px-3.5 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words outline-none md:max-h-[38vh]"
      >
        {lines.length === 1 && !lines[0] ? (
          <span className="text-terminal-foreground/40 italic">No output yet — the agent is starting up.</span>
        ) : (
          lines.map((line, i) => (
            <span key={i} className={cn("block", TONE_CLASS[logTone(line)])}>
              {line || " "}
            </span>
          ))
        )}
      </pre>
    </div>
  );
}
