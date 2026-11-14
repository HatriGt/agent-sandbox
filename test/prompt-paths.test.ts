/**
 * The standing prompts name files the box really has. On 2026-10-02 an edit turned "~/.claude/MEMORY.md"
 * into "\/.claude/MEMORY.md" (which JS reads as "/.claude/MEMORY.md"), and for six weeks every agent ran
 * `cat /.claude/MEMORY.md 2>/dev/null`, got nothing, and planned without the operator's memory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_SYS_PROMPT, MEMORY_PROMPT, OMP_SYS_PROMPT } from "../src/drivers/prompts.ts";
import { MEMORY_MD } from "../src/drivers/memory-tool.ts";

const home = (p: string) => p.replace(/^\/root\//, "~/");

test("the memory prompt points at the file installMemory writes", () => {
  assert.equal(MEMORY_MD, "/root/.claude/MEMORY.md");
  assert.ok(MEMORY_PROMPT.includes(home(MEMORY_MD)), "names ~/.claude/MEMORY.md");
  assert.ok(MEMORY_PROMPT.includes("~/.omp/MEMORY.md"));
  // No path in any prompt starts at the filesystem root's dot-dirs (/.claude, /.omp): those do not exist.
  for (const p of [AGENT_SYS_PROMPT, OMP_SYS_PROMPT]) assert.doesNotMatch(p, /(^|[\s(`'"])\/\.(claude|omp)\//);
});

test("the prompts carry no mojibake (double-encoded UTF-8)", () => {
  for (const p of [AGENT_SYS_PROMPT, OMP_SYS_PROMPT]) assert.doesNotMatch(p, /[ÂÃâð][\u0080-¿Œ-™]/);
});
