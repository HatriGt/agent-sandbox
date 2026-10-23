// Round 8 glow removal: the exact edits, as a rerunnable codemod. Each entry replaces one unique
// string; an entry whose `from` is gone and whose `to` is present is already applied and is skipped.
// Run from the worktree root: node .shots/r8-glow-edits.mjs [--check]
import fs from "node:fs";

const check = process.argv.includes("--check");
const CSS = "web/src/index.css";
const edits = [
  // Dictation: a solid live border instead of a halo. mic-live replaces mic-glow (Hub, SendBar, QuestionCard).
  [CSS,
`   mic-glow: the composer container border/halo while dictation is active.`,
`   mic-live: the composer container border while dictation is active (solid, no halo).`],
  [CSS,
`.mic-glow {
  border-color: color-mix(in oklch, var(--live) 55%, transparent) !important;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--live) 14%, transparent), 0 0 24px -6px color-mix(in oklch, var(--live) 30%, transparent);
}`,
`.mic-live {
  border-color: var(--live) !important;
  outline: 1.5px solid var(--live);
  outline-offset: -1px;
}`],
  // The attention halo under a question or pending schedule: gone. The hairline border is the cue.
  [CSS,
`/* Attention halo for the composer while a machine waits on an answer: a soft, offset glow. */
.attention-glow {
  box-shadow:
    0 1px 2px oklch(0 0 0 / 0.05),
    0 0 0 4px color-mix(in oklch, var(--attention) 7%, transparent),
    0 12px 32px -14px color-mix(in oklch, var(--attention) 45%, transparent);
}

`, ``],
  [CSS,
`/* A question landing: one gentle attention ring swells out of the card after it rises in, then
   quiet. A pseudo-element ring (transform + opacity only) so the card's own shadow is untouched. */
@keyframes attention-pulse {
  0% {
    opacity: 0.55;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(1.025, 1.08);
  }
}
.attention-pulse {
  position: relative;
}
.attention-pulse::after {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  border: 2px solid var(--attention);
  pointer-events: none;
  opacity: 0;
  animation: attention-pulse 0.9s 0.3s var(--ease-out-expo) 1 both;
}
:root[data-motion="reduced"] {
  .attention-pulse::after {
    animation: none;
  }
}

`, ``],
  // The run pill's orb: its bloom and sphere shading go; the shared agent mark rule (below) draws it.
  [CSS,
`/* The agent's "thinking" orb: a small live-blue sphere with a soft bloom that breathes while it works
   (Space UI's loading orb, done in CSS, no WebGL). Static under reduced motion via the global rule. */
@keyframes orb-bloom {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in oklch, var(--live) 45%, transparent);
    transform: scale(0.92);
  }
  50% {
    box-shadow: 0 0 0 4px color-mix(in oklch, var(--live) 0%, transparent);
    transform: scale(1);
  }
}
.orb {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 9999px;
  background: radial-gradient(circle at 32% 30%, color-mix(in oklch, var(--live) 35%, white) 0%, var(--live) 55%, color-mix(in oklch, var(--live) 70%, black) 100%);
  animation: orb-bloom 1.8s var(--ease-in-out-sine) infinite;
}

`, ``],
  // Composer focus: a flat 2px outline in the ring hue, no spread shadow.
  [CSS,
`/* Composer focus: a soft ring eases in around the whole prompt box (box-shadow on the wrapper only,
   no layout). Sits under the drag/voice states, which set their own ring. */
.composer-glow {
  transition:
    border-color var(--dur-base) var(--ease-out-quint),
    box-shadow var(--dur-slow) var(--ease-out-expo);
}
.composer-glow:focus-within {
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 22%, transparent), var(--shadow-e2);
}`,
`/* Composer focus: a flat 2px outline in the ring hue around the whole prompt box (no layout, no
   spread). Sits under the drag/voice states, which set their own border. */
.composer-focus {
  outline: 2px solid transparent;
  outline-offset: 0;
  transition:
    border-color var(--dur-base) var(--ease-out-quint),
    outline-color var(--dur-base) var(--ease-out-quint);
}
.composer-focus:focus-within {
  outline-color: color-mix(in oklch, var(--ring) 40%, transparent);
}`],
  // One flat mark for the agent in three sizes; it breathes (the console's one authored motion) while live.
  [CSS,
`/* The agent's mark: a 14px sphere in the live hue, lit from the top-left. Breathes while live. */
.agent-mark {
  display: inline-block;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 9999px;
  background: radial-gradient(circle at 32% 28%, color-mix(in oklch, var(--live) 40%, white) 0%, var(--live) 52%, color-mix(in oklch, var(--live) 65%, black) 100%);
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--live) 18%, transparent), 0 1px 2px color-mix(in oklch, var(--live) 30%, transparent);
}
.agent-mark-live {
  animation: orb-bloom 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}`,
`/* The agent's mark: a flat disc in the live hue. Three sizes: the run pill (12px), the byline (14px)
   and the reasoning trail (16px). It breathes only while the agent works; the run pill is always live.
   Static under reduced motion via the global rule. */
.orb,
.agent-mark,
.think-orb {
  display: inline-block;
  border-radius: 9999px;
  background: var(--live);
}
.orb {
  width: 0.75rem;
  height: 0.75rem;
}
.agent-mark {
  width: 0.875rem;
  height: 0.875rem;
}
.think-orb {
  width: 1rem;
  height: 1rem;
}
.orb,
.agent-mark-live,
.think-orb-live {
  animation: breathe 2.4s var(--ease-in-out-sine) infinite;
}`],
  // Viz active marks: the expanding box-shadow ring becomes the same breathe.
  [CSS,
`@keyframes viz-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--live) 45%, transparent);
  }
  50% {
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--live) 0%, transparent);
  }
}
.viz-pulse {
  animation: viz-pulse 1.8s ease-in-out infinite;
}`,
`.viz-pulse {
  animation: breathe 1.8s ease-in-out infinite;
}`],
  // The reasoning trail's lit sphere (radial shading, conic sheen, inset rim, bloom): gone.
  [CSS,
`/* Thinking orb: the reasoning trail's mark. A lit sphere in the live hue (highlight top-left, dark
   rim), a slow conic sheen turning inside it, and a soft bloom breathing outward while the agent
   works. Finished, it holds a still frame; reduced motion holds the still frame throughout. */
@keyframes think-orb-turn {
  to { transform: rotate(1turn); }
}
@keyframes think-orb-bloom {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--live) 38%, transparent), 0 1px 2px color-mix(in oklch, var(--live) 30%, transparent); }
  50% { box-shadow: 0 0 0 5px color-mix(in oklch, var(--live) 0%, transparent), 0 1px 2px color-mix(in oklch, var(--live) 30%, transparent); }
}
.think-orb {
  position: relative;
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border-radius: 9999px;
  overflow: hidden;
  isolation: isolate;
  background: radial-gradient(circle at 34% 28%, color-mix(in oklch, var(--live) 28%, white) 0%, color-mix(in oklch, var(--live) 85%, white) 22%, var(--live) 52%, color-mix(in oklch, var(--live) 62%, black) 100%);
  box-shadow: 0 0 0 0 transparent, 0 1px 2px color-mix(in oklch, var(--live) 30%, transparent);
}
.think-orb::before {
  content: "";
  position: absolute;
  inset: -40%;
  border-radius: 9999px;
  background: conic-gradient(from 0deg, transparent 0deg, color-mix(in oklch, white 55%, transparent) 70deg, transparent 140deg, transparent 220deg, color-mix(in oklch, var(--live) 40%, black) 290deg, transparent 360deg);
  opacity: 0.55;
  mix-blend-mode: soft-light;
}
.think-orb::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  box-shadow: inset 0 -1px 2px color-mix(in oklch, var(--live) 50%, black), inset 0 1px 1px color-mix(in oklch, white 35%, transparent);
}
.think-orb-live {
  animation: think-orb-bloom 2s var(--ease-in-out-sine) infinite;
}
.think-orb-live::before {
  animation: think-orb-turn 3.6s linear infinite;
}
:root[data-motion="reduced"] .think-orb,
:root[data-motion="reduced"] .think-orb::before {
  animation: none;
}

`, ``],

  // Components.
  ["web/src/components/thread/SendBar.tsx",
`"bg-card composer-glow composer-depth border-line-strong rounded-2xl p-2",`,
`"bg-card composer-focus composer-depth border-line-strong rounded-2xl p-2",`],
  ["web/src/components/thread/SendBar.tsx",
`(voice.state === "listening" || voice.state === "arming") && "mic-glow"
          )}
          onPaste={onPaste}`,
`(voice.state === "listening" || voice.state === "arming") && "mic-live"
          )}
          onPaste={onPaste}`],
  ["web/src/components/thread/QuestionCard.tsx",
`className="border-attention/50 bg-card focus-visible:ring-attention/40 attention-glow attention-pulse max-w-[72ch] rounded-xl border outline-none focus-visible:ring-2"`,
`className="border-attention/50 bg-card focus-visible:ring-attention/40 max-w-[72ch] rounded-xl border outline-none focus-visible:ring-2"`],
  ["web/src/components/thread/QuestionCard.tsx",
`(voice.state === "listening" || voice.state === "arming") && "mic-glow ring-0")}>`,
`(voice.state === "listening" || voice.state === "arming") && "mic-live ring-0")}>`],
  ["web/src/components/thread/ScheduledCard.tsx",
`pending && "border-attention/50 attention-glow attention-pulse",`,
`pending && "border-attention/50",`],
  ["web/src/components/Hub.tsx",
`(voice.state === "listening" || voice.state === "arming") && "mic-glow"`,
`(voice.state === "listening" || voice.state === "arming") && "mic-live"`],
  // Hairline state rings drawn as box-shadow become borders, so nothing in the column paints a coloured shadow.
  ["web/src/components/thread/McpItem.tsx",
`<div className={cn("bg-trace overflow-hidden rounded-md border border-white/8", live && "ring-live/40 ring-1")}>`,
`<div className={cn("bg-trace overflow-hidden rounded-md border", live ? "border-live/40" : "border-white/8")}>`],
  ["web/src/components/thread/BootingThread.tsx",
`<span className="bg-live/10 text-live ring-live/20 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset">`,
`<span className="bg-live/10 text-live border-live/20 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-micro font-semibold">`],
  ["web/src/components/viz/ExplainBlocks.tsx",
`o.picked && "border-live/60 ring-live/25 ring-2",`,
`o.picked && "border-live/60",`],
  // The column root, for the fixture.
  ["web/src/components/thread/Thread.tsx",
`<div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showWorkspace && workspaceFull && "hidden md:hidden")}>`,
`<div data-thread className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showWorkspace && workspaceFull && "hidden md:hidden")}>`],
];

let applied = 0, skipped = 0, failed = 0;
const files = new Map();
const read = (f) => files.get(f) ?? (files.set(f, fs.readFileSync(f, "utf8")), files.get(f));
for (const [file, from0, to0] of edits) {
  const src = read(file);
  const crlf = src.includes("\r\n");
  const eol = (t) => (crlf ? t.replace(/\r?\n/g, "\r\n") : t);
  const [from, to] = [eol(from0), eol(to0)];
  const n = src.split(from).length - 1;
  const label = `${file}: ${from0.trim().split("\n")[0].slice(0, 70)}`;
  // Already applied: the old text is gone and the new text is present, or for a deletion the old
  // block's first line is absent.
  const firstLine = from0.trim().split("\n")[0].trim();
  const done = to0 === "" ? !src.includes(firstLine) : src.includes(to);
  if (n === 1) { files.set(file, src.replace(from, () => to)); applied++; console.log(`${check ? "WOULD APPLY" : "APPLY"} ${label}`); }
  else if (n === 0 && done) { skipped++; console.log(`DONE  ${label}`); }
  else { failed++; console.log(`FAIL  ${label} (matches=${n})`); }
}
if (!check && !failed) for (const [f, s] of files) fs.writeFileSync(f, s);
console.log(`\n${applied} applied, ${skipped} already done, ${failed} failed${failed ? " (nothing written)" : ""}`);
process.exit(failed ? 1 : 0);
