/**
 * Minimal .env loader (no dependency). Reads KEY=VALUE lines into process.env without
 * overriding vars already set by the environment (so an MCP launch config can still win).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadDotEnv(file?: string): void {
  // Default to a .env sitting next to the compiled bundle's project root (dist/../.env).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = file ?? path.resolve(here, "..", ".env");
  if (!fs.existsSync(target)) return;

  for (const line of fs.readFileSync(target, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
