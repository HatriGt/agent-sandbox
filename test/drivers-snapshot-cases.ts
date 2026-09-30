/**
 * The shell-emission matrix pinned by test/drivers-claude.test.ts. Shared by the test and by the
 * one-off generator that captured test/fixtures/drivers-snapshot.json from the PRE-refactor
 * msb.ts, so the driver extraction is provably byte-identical.
 */
import { agentSh, agentEnvFlags, bootstrapScript } from "../src/msb.js";
import type { Config } from "../src/config.js";

const base = {
  claudeCodeVersion: "2.1.273",
  ompVersion: "latest",
  anthropicBaseUrl: "http://ccproxy:8080",
  anthropicApiKey: "sk-test",
  anthropicModel: "sonnet",
} as unknown as Config;

export function snapshotCases(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kind of ["claude", "omp"] as const) {
    for (const resume of [false, true]) {
      for (const wd of ["/workspace", "/workspace/repo"]) {
        out[`agentSh:${kind}:${resume ? "resume" : "first"}:${wd}`] = agentSh(wd, resume, kind);
      }
    }
    for (const npmToken of [undefined, "npm-tok"]) {
      out[`bootstrap:${kind}:npm=${npmToken ?? "none"}`] = bootstrapScript({ ...base, npmToken } as Config, kind);
    }
    for (const askModel of [undefined, "haiku"]) {
      const cfg = { ...base, askModel, npmToken: "npm-tok" } as Config;
      out[`env:${kind}:bare:ask=${askModel ?? "none"}`] = agentEnvFlags(cfg, "do the thing", undefined, undefined, undefined, kind);
      out[`env:${kind}:full:ask=${askModel ?? "none"}`] = agentEnvFlags(cfg, "fix it", [{ name: "repo" }], "gh-tok", "opus", kind);
    }
  }
  return out;
}
