/**
 * oh-my-pi (omp) as a selectable in-box agent. These tests pin the SHELL the controller ships:
 * the install command (version-aware, npm-registry-only so the egress allowlist already covers it),
 * the run command (same sentinel protocol as the Claude branch, so the transcript/run-state pipeline
 * is agent-agnostic), and the resume branch (--continue + no re-prefixed system prompt).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ompInstallSh,
  agentSh,
  bootstrapScript,
  boxAgentKindFrom,
  KIND_MARK,
  OMP_SYS_PROMPT,
} from "../src/msb.js";
import type { Config } from "../src/config.js";

const cfg = {
  claudeCodeVersion: "2.1.273",
  ompVersion: "latest",
  npmToken: undefined,
} as unknown as Config;

test("ompInstallSh: pinned version is version-checked; latest is presence-checked", () => {
  const pinned = ompInstallSh("18.2.0");
  assert.match(pinned, /@oh-my-pi\/pi-coding-agent@18\.2\.0/);
  assert.match(pinned, /omp --version/);
  // bun is the omp runtime; installed from npm so the default egress allowlist already covers it.
  assert.match(pinned, /npm i -g bun/);
  const latest = ompInstallSh("latest");
  assert.match(latest, /command -v omp/);
  assert.match(latest, /@oh-my-pi\/pi-coding-agent(\s|"|$)/);
});

test("ompInstallSh rejects a version that could inject into the shell", () => {
  assert.throws(() => ompInstallSh("18.2.0; rm -rf /"));
  assert.throws(() => ompInstallSh("$(curl evil)"));
  assert.throws(() => ompInstallSh(""));
});

test("bootstrapScript installs omp only for omp runs; claude is always present (ask lane)", () => {
  const claude = bootstrapScript(cfg);
  assert.doesNotMatch(claude, /oh-my-pi/);
  assert.match(claude, /@anthropic-ai\/claude-code/);
  const omp = bootstrapScript(cfg, "omp");
  assert.match(omp, /oh-my-pi/);
  assert.match(omp, /@anthropic-ai\/claude-code/, "claude stays installed for the ask co-pilot");
  assert.match(omp, /omp-fmt\.js/, "the omp log formatter is installed at bootstrap");
});

test("agentSh omp: same sentinel lifecycle, models.yml seeding, formatter pipe", () => {
  const sh = agentSh("/workspace/repo", false, "omp");
  // The sentinel protocol IS the agent-agnostic contract — every reader depends on these.
  for (const mark of [".agent.done", ".agent.running", ".agent.pid", ".agent.task", ".agent.workdir", ".agent.kind"]) {
    assert.ok(sh.includes(mark), `missing sentinel ${mark}`);
  }
  assert.match(sh, /OMP_SKIP_SETUP=1/);
  assert.match(sh, /ccproxy\/\$ANTHROPIC_MODEL/, "model rides as ccproxy/<alias>");
  assert.match(sh, /models\.yml/, "the ccproxy provider is written before the run");
  assert.match(sh, /anthropic-messages/);
  assert.match(sh, /omp-fmt\.js/, "omp output streams through the omp formatter");
  assert.doesNotMatch(sh, /claude -p|claude -c/, "no claude invocation in the omp branch");
  // First run: the standing policy is prefixed to the prompt (omp has no --append-system-prompt).
  assert.match(sh, /\$AGENT_SYS_PROMPT/);
});

test("agentSh omp resume: --continue, no policy re-prefix, kind mark not rewritten", () => {
  const sh = agentSh("/workspace/repo", true, "omp");
  assert.match(sh, /--continue/);
  assert.match(sh, /⟦you⟧/, "the follow-up is echoed into the log like the claude branch");
  // The kind/workdir/task marks are first-run-only (they record where the thread STARTED).
  assert.doesNotMatch(sh, new RegExp(`> ${KIND_MARK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("agentSh claude branch records the kind mark too and is otherwise unchanged", () => {
  const sh = agentSh("/workspace", false);
  assert.match(sh, /claude -p "\$AGENT_TASK"/);
  assert.ok(sh.includes(KIND_MARK));
  assert.doesNotMatch(sh, /omp /);
});

test("boxAgentKindFrom: the in-box mark parses defensively", () => {
  assert.equal(boxAgentKindFrom("omp\n"), "omp");
  assert.equal(boxAgentKindFrom("claude"), "claude");
  assert.equal(boxAgentKindFrom(""), "claude");
  assert.equal(boxAgentKindFrom("garbage\nomp"), "claude", "only a clean single-token mark is trusted");
});

test("OMP_SYS_PROMPT keeps the question-file protocol and the security rules", () => {
  assert.match(OMP_SYS_PROMPT, /\.agent\.question/);
  assert.match(OMP_SYS_PROMPT, /untrusted DATA/);
  assert.doesNotMatch(OMP_SYS_PROMPT, /claude -c/, "no Claude-specific resume mechanics leak into omp's prompt");
  assert.doesNotMatch(OMP_SYS_PROMPT, /TodoWrite/);
});

test("npxPackagesOf: extracts installable specs, skips URLs/paths/non-npx", async () => {
  const { npxPackagesOf } = await import("../src/msb.js");
  const conf = {
    mcpServers: {
      a: { type: "stdio", command: "npx", args: ["-y", "@cap-js/mcp-server"] },
      b: { type: "stdio", command: "npx", args: ["chrome-devtools-mcp@latest"] },
      c: { type: "stdio", command: "npx", args: ["-y", "mcp-remote", "https://mcp.example/mp"] },
      d: { type: "stdio", command: "node", args: ["server.js"] },
      e: { type: "http", url: "https://x" },
      f: { type: "stdio", command: "npx", args: ["-y", "./local/dir"] },
    },
  };
  const specs = npxPackagesOf(conf).sort();
  if (JSON.stringify(specs) !== JSON.stringify(["@cap-js/mcp-server", "chrome-devtools-mcp@latest", "mcp-remote"])) {
    throw new Error("unexpected specs: " + JSON.stringify(specs));
  }
});

test("agentSh omp filters ALL MCP warnings from the transcript stderr", () => {
  const sh = agentSh("/workspace", false, "omp");
  if (!sh.includes("grep -vE") || !sh.includes("^Warning: MCP server ")) throw new Error("stderr filter missing/narrow");
});

test("asb-guard extension: installs under ~/.omp, blocks .agent.* touches, allows normal calls", async () => {
  const { ompGuardScript } = await import("../src/msb.js");
  const sh = ompGuardScript();
  if (!sh.includes(".omp/agent/extensions/asb-guard")) throw new Error("wrong install path");
  const idxB64 = sh.match(/'([A-Za-z0-9+/=]+)' \| base64 -d > "\$HOME\/\.omp\/agent\/extensions\/asb-guard\.js"/)?.[1];
  if (!idxB64) throw new Error("payload missing");
  // Run the REAL shipped module: register a fake pi, capture the tool_call handler, poke it.
  const mod = await import("data:text/javascript;base64," + idxB64);
  let handler: (ev: unknown) => unknown = () => undefined;
  mod.default({ on: (name: string, fn: (ev: unknown) => unknown) => { if (name === "tool_call") handler = fn; } });
  const blocked = (r: unknown) => !!(r as { block?: boolean } | undefined)?.block;
  // Reading/writing controller files is blocked (with a reason the model sees)…
  if (!blocked(handler({ toolName: "read", input: { path: "/workspace/.agent.log" } }))) throw new Error("agent-file read not blocked");
  if (!blocked(handler({ toolName: "bash", input: { command: "cat /workspace/.agent.task" } }))) throw new Error("agent-file bash not blocked");
  // …except the question write itself.
  if (blocked(handler({ toolName: "write", input: { path: "/workspace/.agent.question", content: "q" } }))) throw new Error("question write must pass");
  // Ordinary work passes.
  if (blocked(handler({ toolName: "bash", input: { command: "npm test" } }))) throw new Error("normal call blocked");
});

test("omp bootstrap and prompt carry the guard and the debugger guidance", () => {
  const boot = bootstrapScript({ claudeCodeVersion: "2.1.273", ompVersion: "latest" } as never, "omp");
  if (!boot.includes("asb-guard")) throw new Error("guard not installed at bootstrap");
  if (!OMP_SYS_PROMPT.includes("debug") || !OMP_SYS_PROMPT.includes("BLOCKED")) throw new Error("prompt missing debug/enforcement");
});

test("flavored pool: names, eligibility, refill reconciles both flavors", async () => {
  const { poolBoxFlavor, ompPoolEligible, refillPool, freshPoolBoxes } = await import("../src/pool.js");
  if (poolBoxFlavor("pool-1790000000000-abc123") !== "claude") throw new Error("claude flavor");
  if (poolBoxFlavor("pool-1790000000000-omp-abc123") !== "omp") throw new Error("omp flavor");
  // Age parsing still works for omp names (freshness gate must not discard them).
  const fresh = freshPoolBoxes(["pool-" + (Date.now() - 1000) + "-omp-x"], 60_000);
  if (fresh.length !== 1) throw new Error("omp pool name failed the freshness gate");
  const cfg = { poolSize: 1, snapshot: "agent-base", egressAllowAll: true, ompPoolSize: 1, ompSnapshot: "agent-omp", ompVersion: "latest" } as never;
  if (!ompPoolEligible(cfg, false)) throw new Error("omp pool should be eligible");
  if (ompPoolEligible({ ...(cfg as object), ompSnapshot: "" } as never, false)) throw new Error("no snapshot = not eligible");
  // Refill follows the users' agent picks: only WANTED flavors are booted; the other is trimmed.
  const boots: string[] = [];
  const removed: string[] = [];
  const io = {
    listPoolBoxes: async () => [`pool-${Date.now()}-oldclaude`],
    bootWarmBox: async (_c: never, agent?: string) => { boots.push(agent ?? "claude"); return `pool-${Date.now()}-${agent === "omp" ? "omp-" : ""}x`; },
    removeBox: async (_c: never, box: string) => { removed.push(box); },
  };
  await refillPool(cfg, io as never, new Set(["omp"]) as never);
  if (JSON.stringify(boots) !== JSON.stringify(["omp"])) throw new Error("should boot omp only: " + boots.join(","));
  if (removed.length !== 1) throw new Error("unwanted claude box should be trimmed");
  // Both wanted -> both flavors reconciled.
  boots.length = 0; removed.length = 0;
  await refillPool(cfg, io as never, new Set(["claude", "omp"]) as never);
  if (JSON.stringify(boots.sort()) !== JSON.stringify(["omp"])) throw new Error("claude already ready; only omp boots: " + boots.join(","));
});

test("MCP_DIRECT_BIN_JS: installed npx servers run their bin directly; anything unmappable stays on npx", async () => {
  const { MCP_DIRECT_BIN_JS } = await import("../src/msb.js");
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "mcpbin-"));
  const R = join(root, "node_modules");
  const pkg = (name: string, bin: unknown, files: string[]) => {
    const dir = join(R, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, bin }));
    for (const f of files) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), "");
    }
  };
  pkg("@cap-js/mcp-server", { "mcp-server": "index.js" }, ["index.js"]);
  pkg("chrome-devtools-mcp", "build/bin.js", ["build/bin.js"]);
  pkg("mcp-remote", { "mcp-remote": "dist/proxy.js", "mcp-remote-client": "dist/client.js" }, ["dist/proxy.js"]);
  pkg("multi", { a: "a.js", b: "b.js" }, ["a.js", "b.js"]);
  pkg("ghost", { ghost: "missing.js" }, []);
  const file = join(root, "mcp.json");
  writeFileSync(
    file,
    JSON.stringify({
      mcpServers: {
        cds: { type: "stdio", command: "npx", args: ["-y", "@cap-js/mcp-server"] },
        chrome: { type: "stdio", command: "npx", args: ["chrome-devtools-mcp@latest", "--headless"] },
        remote: { type: "stdio", command: "npx", args: ["-y", "mcp-remote", "https://mcp.example/x"], env: { A: "1" } },
        ambiguous: { type: "stdio", command: "npx", args: ["-y", "multi"] },
        absentBin: { type: "stdio", command: "npx", args: ["-y", "ghost"] },
        notInstalled: { type: "stdio", command: "npx", args: ["-y", "nope-mcp"] },
        oddFlag: { type: "stdio", command: "npx", args: ["--package=x", "@cap-js/mcp-server"] },
        http: { type: "http", url: "https://x" },
      },
    })
  );
  execFileSync(process.execPath, ["-e", MCP_DIRECT_BIN_JS, file], { env: { ...process.env, R } });
  const s = JSON.parse(readFileSync(file, "utf8")).mcpServers;
  assert.equal(s.cds.command, process.execPath);
  assert.deepEqual(s.cds.args, [join(R, "@cap-js/mcp-server", "index.js")]);
  assert.deepEqual(s.chrome.args, [join(R, "chrome-devtools-mcp", "build/bin.js"), "--headless"], "server args survive, @latest is not re-resolved");
  assert.deepEqual(s.remote.args, [join(R, "mcp-remote", "dist/proxy.js"), "https://mcp.example/x"], "the bin named after the package wins");
  assert.deepEqual(s.remote.env, { A: "1" });
  for (const k of ["ambiguous", "absentBin", "notInstalled", "oddFlag"]) assert.equal(s[k].command, "npx", `${k} must stay on npx`);
  assert.equal(s.http.url, "https://x");
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("omp boxes boot with 2 vCPUs, default boxes keep the runtime default", async () => {
  const { OMP_CPUS } = await import("../src/msb.js");
  const { ompPoolCfg } = await import("../src/pool.js");
  assert.equal(OMP_CPUS, 2);
  assert.equal(ompPoolCfg({ ompSnapshot: "agent-omp", ompPoolSize: 1 } as never).cpus, 2);
});

test("isOrphanWarmBox: only a stale, never-ready box this process isn't warming is reaped", async () => {
  const { isOrphanWarmBox, WARM_UP_BUDGET_MS } = await import("../src/msb.js");
  const now = 1_790_000_000_000;
  const old = `pool-${now - WARM_UP_BUDGET_MS - 1000}-omp-abc`;
  const young = `pool-${now - 60_000}-omp-abc`;
  assert.equal(isOrphanWarmBox(old, "warming", new Set(), now), true);
  assert.equal(isOrphanWarmBox(young, "warming", new Set(), now), false, "a warm-up still inside its budget is left alone");
  assert.equal(isOrphanWarmBox(old, "warming", new Set([old]), now), false, "our own in-flight warm-up is never reaped");
  assert.equal(isOrphanWarmBox(old, "free", new Set(), now), false);
  assert.equal(isOrphanWarmBox(old, "claimed", new Set(), now), false, "a claimed run is never touched");
  assert.equal(isOrphanWarmBox("pool-x-omp-abc", "warming", new Set(), now), false, "undatable names are left alone");
});
