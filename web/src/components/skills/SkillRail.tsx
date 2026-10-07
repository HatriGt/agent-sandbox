import * as React from "react";
import { ArrowUpRight, Clock, Github, RefreshCw, Sparkles, Terminal } from "lucide-react";
import type { SkillView } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SkillTile } from "./SkillLibrary";

/**
 * The library's right rail: how a skill reaches the agent (three facts, not a paragraph), a teaser
 * for the curated import, and the skills touched most recently. It gives the page a composed shape
 * when the list is short and stays useful when it is long.
 */
export function SkillRail({ skills, onOpen, onImport, className }: { skills: SkillView[]; onOpen: (s: SkillView) => void; onImport: (repo?: string) => void; className?: string }) {
  const recent = React.useMemo(() => [...skills].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [skills]);
  return (
    <aside className={cn("flex flex-col gap-6", className)} aria-label="About skills">
      <RailSection title="How skills reach the agent">
        <ul className="flex flex-col divide-y">
          <Fact icon={Terminal} title={<>Typed as <span className="stamp text-foreground bg-muted rounded px-1 py-px">/name</span></>} line="In any chat, the way you would run a command." />
          <Fact icon={Sparkles} title="Matched on its own" line="When a task fits the description, the agent picks it up unprompted." />
          <Fact icon={RefreshCw} title="Synced on the next turn" line="Every sandbox gets the current version — turn one off to hold it back." />
        </ul>
      </RailSection>

      <RailSection title="Curated">
        <button
          type="button"
          onClick={() => onImport("anthropics/skills")}
          className="group bg-card hover:border-line-strong flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-left transition-[border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] [@media(hover:hover)]:hover:shadow-e1"
        >
          <span className="bg-muted text-muted-foreground group-hover:text-foreground grid size-8 shrink-0 place-items-center rounded-lg transition-colors" aria-hidden>
            <Github className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="stamp text-foreground block text-[12.5px] font-medium">anthropics/skills</span>
            <span className="text-muted-foreground mt-0.5 block text-micro leading-snug">Anthropic's own collection — documents, design, research. Browse and pull one in.</span>
          </span>
          <ArrowUpRight className="text-muted-foreground group-hover:text-foreground mt-0.5 size-3.5 shrink-0 -translate-x-0.5 translate-y-0.5 opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100" aria-hidden />
        </button>
      </RailSection>

      {recent.length > 0 && (
        <RailSection title="Recently edited">
          <ul className="bg-card divide-y overflow-hidden rounded-xl border">
            {recent.map((s) => (
              <li key={s.name}>
                <button type="button" onClick={() => onOpen(s)} className="group hover:bg-muted/50 flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100">
                  <SkillTile name={s.name} enabled={s.enabled} />
                  <span className="min-w-0 flex-1">
                    <span className="stamp text-foreground block truncate text-[12px] font-medium">/{s.name}</span>
                    <span className="text-faint flex items-center gap-1 text-micro">
                      <Clock className="size-2.5" aria-hidden />
                      {fmtAgo(Math.floor(s.updatedAt / 1000))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </RailSection>
      )}
    </aside>
  );
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="label text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ icon: Icon, title, line }: { icon: React.ComponentType<{ className?: string }>; title: React.ReactNode; line: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className="text-muted-foreground mt-0.5 shrink-0" aria-hidden>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="text-foreground block text-meta font-medium">{title}</span>
        <span className="text-muted-foreground block text-micro leading-snug">{line}</span>
      </span>
    </li>
  );
}
