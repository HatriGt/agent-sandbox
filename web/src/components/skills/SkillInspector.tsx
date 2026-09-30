import * as React from "react";
import { Check, Copy, FolderTree } from "lucide-react";
import type { SkillView } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import type { SkillFile } from "@/lib/skillImport";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { byteLength, fmtKb, MAX_CONTENT } from "./model";

/**
 * How the agent sees it: the two ways the skill fires, where it lands in the sandbox, what it
 * weighs, and when it was last saved. Facts, not controls — the one control is the on/off switch,
 * which saves immediately for an existing skill. Sits at the right on wide screens; a sheet on a phone.
 */
export function SkillInspector({
  name,
  description,
  content,
  files,
  saved,
  enabled,
  onToggle,
  toggling,
  className,
}: {
  name: string;
  description: string;
  content: string;
  files: SkillFile[];
  saved?: SkillView;
  enabled: boolean;
  onToggle?: (next: boolean) => void;
  toggling?: boolean;
  className?: string;
}) {
  const slug = name || "your-skill";
  const bodyBytes = byteLength(content);
  const total = bodyBytes + files.reduce((n, f) => n + byteLength(f.content), 0);
  const pct = Math.min(100, Math.round((content.length / MAX_CONTENT) * 100));
  const paths = React.useMemo(() => ["SKILL.md", ...files.map((f) => f.path).sort()], [files]);

  return (
    <div className={cn("flex flex-col gap-6 text-meta", className)}>
      <Section title="Fires when">
        <ul className="flex flex-col gap-2.5">
          <li className="flex items-start gap-2.5">
            <span className="bg-muted text-foreground stamp mt-px shrink-0 rounded-md border px-1.5 py-0.5 text-micro">/{slug}</span>
            <span className="text-muted-foreground leading-snug">is typed in chat.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="bg-muted text-foreground stamp mt-px shrink-0 rounded-md border px-1.5 py-0.5 text-micro">auto</span>
            <span className="text-muted-foreground min-w-0 leading-snug">
              {description.trim() ? (
                <span className="line-clamp-4">
                  a task matches <span className="text-foreground/80">“{description.trim()}”</span>
                </span>
              ) : (
                <span className="text-faint">a task matches the description — write one above.</span>
              )}
            </span>
          </li>
        </ul>
      </Section>

      {saved && onToggle && (
        <Section title="Status">
          <label className="bg-card hover:border-line-strong flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors">
            <span className="flex min-w-0 flex-col">
              <span className="text-foreground font-medium">{enabled ? "On" : "Off"}</span>
              <span className="text-muted-foreground text-micro leading-snug">{enabled ? "Synced into every sandbox on its next turn." : "Kept here, not given to the agent."}</span>
            </span>
            <Switch checked={enabled} onCheckedChange={onToggle} disabled={toggling} aria-label={enabled ? "Turn off" : "Turn on"} />
          </label>
        </Section>
      )}

      <Section title="In the sandbox" trailing={<CopyPath text={`~/.claude/skills/${slug}/`} />}>
        <div className="bg-card rounded-lg border px-3 py-2.5">
          <div className="text-muted-foreground stamp flex items-center gap-1.5 text-micro">
            <FolderTree className="size-3 shrink-0" aria-hidden />
            ~/.claude/skills/{slug}/
          </div>
          <ul className="stamp mt-1.5 flex flex-col gap-1 pl-[18px] text-micro">
            {paths.slice(0, 8).map((p) => (
              <li key={p} className="text-foreground/85 flex items-center gap-2 truncate">
                <span className="bg-border h-px w-2 shrink-0" aria-hidden />
                {p}
              </li>
            ))}
            {paths.length > 8 && <li className="text-faint pl-4">+{paths.length - 8} more</li>}
          </ul>
        </div>
      </Section>

      <Section title="Size">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">SKILL.md</dt>
          <dd className="text-foreground tabular text-right">{fmtKb(bodyBytes)}</dd>
          {files.length > 0 && (
            <>
              <dt className="text-muted-foreground">
                {files.length} supporting file{files.length === 1 ? "" : "s"}
              </dt>
              <dd className="text-foreground tabular text-right">{fmtKb(total - bodyBytes)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Instructions</dt>
          <dd className={cn("tabular text-right", pct >= 90 ? "text-destructive" : "text-foreground")}>{pct}% of limit</dd>
        </dl>
        <div className="bg-muted mt-2 h-1 overflow-hidden rounded-full" aria-hidden>
          <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", pct >= 90 ? "bg-destructive" : "bg-foreground/40")} style={{ width: `${Math.max(pct, content.length ? 1.5 : 0)}%` }} />
        </div>
      </Section>

      {saved && (
        <Section title="History">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted-foreground">Last saved</dt>
            <dd className="text-foreground tabular text-right" title={new Date(saved.updatedAt).toLocaleString()}>
              {fmtAgo(Math.floor(saved.updatedAt / 1000))}
            </dd>
            <dt className="text-muted-foreground">Added</dt>
            <dd className="text-foreground tabular text-right">{new Date(saved.addedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</dd>
          </dl>
        </Section>
      )}
    </div>
  );
}

function Section({ title, trailing, children }: { title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="label text-muted-foreground">{title}</h3>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function CopyPath({ text }: { text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Copy path"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setDone(true);
            window.setTimeout(() => setDone(false), 1200);
          }}
          className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded transition-colors"
        >
          {done ? <Check className="text-ok size-3" /> : <Copy className="size-3" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{done ? "Copied" : "Copy path"}</TooltipContent>
    </Tooltip>
  );
}
