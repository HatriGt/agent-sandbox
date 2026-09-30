import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Self-hosted, monochrome brand marks for the landing logo strip (CSP: no third-party assets).
 * Everything draws in `currentColor`, so the strip themes with light/dark. Where an official mark
 * can't be reproduced faithfully as a simple path, the brand is set as a neat wordmark instead of
 * a guessed logo.
 */

type MarkProps = { className?: string };

/** Anthropic's "A" letterform. */
function AnthropicGlyph({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223 2.291-5.946 2.292 5.946Z" />
    </svg>
  );
}

/** Claude's radiating burst, drawn as tapered rays. */
function ClaudeGlyph({ className }: MarkProps) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    const r1 = 2.2;
    const r2 = i % 2 ? 8.4 : 10.4;
    return <line key={i} x1={12 + Math.cos(a) * r1} y1={12 + Math.sin(a) * r1} x2={12 + Math.cos(a) * r2} y2={12 + Math.sin(a) * r2} />;
  });
  return (
    <svg viewBox="0 0 24 24" className={className} stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" aria-hidden>
      {rays}
    </svg>
  );
}

/** A four-point sparkle (Gemini). */
function SparkleGlyph({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10Z" />
    </svg>
  );
}

/** A terminal prompt (Codex CLI). */
function PromptGlyph({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="4" width="19" height="16" rx="4" />
      <path d="m7.5 10 2.5 2-2.5 2M12.5 15h4" />
    </svg>
  );
}

export type Brand = {
  key: string;
  name: string;
  /** "soon": planned, not built yet. */
  soon?: boolean;
  render: (cls: string) => React.ReactNode;
};

const word = (text: string, cls?: string) => <span className={cn("leading-none whitespace-nowrap", cls)}>{text}</span>;

export const AGENT_BRANDS: Brand[] = [
  { key: "claude-code", name: "Claude Code", render: (c) => <><ClaudeGlyph className={c} />{word("Claude Code", "font-semibold tracking-[-0.02em]")}</> },
  { key: "codex", name: "Codex CLI", render: (c) => <><PromptGlyph className={c} />{word("Codex", "font-semibold tracking-[-0.02em]")}</> },
  { key: "opencode", name: "OpenCode", render: () => word("opencode", "font-mono font-semibold tracking-[-0.04em]") },
  { key: "oh-my-pi", name: "oh-my-pi", render: () => <>{word("π", "font-serif text-[1.3em] -mt-0.5")}{word("oh-my-pi", "font-mono font-semibold tracking-[-0.03em]")}</> },
  { key: "gemini", name: "Gemini CLI", soon: true, render: (c) => <><SparkleGlyph className={c} />{word("Gemini CLI", "font-semibold tracking-[-0.015em]")}</> },
];

export const MODEL_BRANDS: Brand[] = [
  { key: "anthropic", name: "Anthropic", render: (c) => <><AnthropicGlyph className={c} />{word("Anthropic", "font-semibold tracking-[-0.01em]")}</> },
  { key: "openai", name: "OpenAI", render: () => word("OpenAI", "font-semibold tracking-[-0.035em]") },
  { key: "compatible", name: "OpenAI-compatible endpoints", render: () => word("OpenAI-compatible", "font-semibold tracking-[-0.025em]") },
  { key: "ollama", name: "Ollama", render: () => word("ollama", "font-semibold tracking-[-0.03em]") },
];
