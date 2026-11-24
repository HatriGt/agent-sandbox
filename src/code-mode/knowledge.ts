/**
 * Code mode, what an owner's runs have learned about their MCP servers (docs/plan-code-mode.md
 * §13): the shape of each tool's result and how many tools each server has. The in-box server
 * writes it as knowledge.json after every script; the controller harvests it when a run finishes,
 * merges it into the owner's blob and ships the merged file with the next install. A fresh box
 * starts knowing what the last one learned: no shape-probing script, and the auto decision has
 * the tool counts it needs.
 */
import { loadBlob, saveBlob, ownerKey } from "../user-store.js";
import type { McpKnowledge } from "./index.js";

export { CODE_MODE_KNOWLEDGE_FILE, knowledgeFile, type McpKnowledge } from "./index.js";

export const MCP_KNOWLEDGE_KIND = "mcp-knowledge";

const SHAPES_MAX = 500;
const SERVERS_MAX = 200;
const SHAPE_MAX_CHARS = 2000;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export const emptyKnowledge = (): McpKnowledge => ({ shapes: {}, toolCounts: {} });

/** A knowledge object from any JSON text; anything malformed is dropped field by field. */
export function parseKnowledge(raw: string | null | undefined): McpKnowledge {
  const out = emptyKnowledge();
  if (!raw) return out;
  let j: { shapes?: unknown; toolCounts?: unknown; updatedAt?: unknown };
  try {
    j = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!j || typeof j !== "object") return out;
  if (j.shapes && typeof j.shapes === "object" && !Array.isArray(j.shapes)) {
    for (const [k, v] of Object.entries(j.shapes as Record<string, unknown>)) {
      if (typeof v === "string" && KEY_RE.test(k)) out.shapes[k] = v.slice(0, SHAPE_MAX_CHARS);
    }
  }
  if (j.toolCounts && typeof j.toolCounts === "object" && !Array.isArray(j.toolCounts)) {
    for (const [k, v] of Object.entries(j.toolCounts as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && KEY_RE.test(k)) out.toolCounts[k] = v;
    }
  }
  if (typeof j.updatedAt === "number" && Number.isFinite(j.updatedAt)) out.updatedAt = j.updatedAt;
  return out;
}

/** `b` over `a`, newest last so the caps drop the oldest entries first. */
export function mergeKnowledge(a: McpKnowledge, b: McpKnowledge, now = Date.now()): McpKnowledge {
  const shapes: Record<string, string> = { ...a.shapes };
  for (const [k, v] of Object.entries(b.shapes)) {
    delete shapes[k];
    shapes[k] = v;
  }
  const toolCounts: Record<string, number> = { ...a.toolCounts };
  for (const [k, v] of Object.entries(b.toolCounts)) {
    delete toolCounts[k];
    toolCounts[k] = v;
  }
  return { shapes: tail(shapes, SHAPES_MAX), toolCounts: tail(toolCounts, SERVERS_MAX), updatedAt: now };
}

function tail<T>(m: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(m);
  return keys.length <= max ? m : Object.fromEntries(keys.slice(keys.length - max).map((k) => [k, m[k]]));
}

/** The owner's knowledge; none stored (or no store backend) reads as empty, never throws. */
export function loadKnowledge(owner = ownerKey()): McpKnowledge {
  try {
    return parseKnowledge(loadBlob(MCP_KNOWLEDGE_KIND, owner));
  } catch {
    return emptyKnowledge();
  }
}

export function saveKnowledge(k: McpKnowledge, owner = ownerKey()): void {
  saveBlob(MCP_KNOWLEDGE_KIND, JSON.stringify(k), owner);
}

/** What a box brought back, folded into the owner's blob. Returns the merged result. */
export function absorbKnowledge(fromBox: McpKnowledge, owner = ownerKey(), now = Date.now()): McpKnowledge {
  const merged = mergeKnowledge(loadKnowledge(owner), fromBox, now);
  saveKnowledge(merged, owner);
  return merged;
}

/** True when the box's copy says more than what was shipped (so a harvest is worth a write). */
export function knowledgeGrew(shipped: McpKnowledge, fromBox: McpKnowledge): boolean {
  for (const [k, v] of Object.entries(fromBox.shapes)) if (shipped.shapes[k] !== v) return true;
  for (const [k, v] of Object.entries(fromBox.toolCounts)) if (shipped.toolCounts[k] !== v) return true;
  return false;
}
