// Code mode, Phase 2 wiring: the flag, the one-exec install plan (run for real in sh against a fake
// root, with a stub server whose --check passes or fails), the notes it leaves, the launch's
// allowed-tools derivation and system-prompt paragraph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeModeEnabled, normalizeAgentPrefs } from "../src/agent-kind.ts";
import { CODE_MODE_PROMPT, CODE_MODE_SERVER, CODE_MODE_UPSTREAM_PATH, codeModeWrapperConfig } from "../src/code-mode/index.ts";
import { claudeLaunchSh } from "../src/drivers/claude.ts";
import { MCP_CONFIG_PATH } from "../src/drivers/sentinels.ts";
import { codeModePayload, mcpInstallNotes, mcpInstallSh, mcpProvisionState, MCP_NOTES_PATH, OMP_MCP_CONFIG_PATH, rememberProvision } from "../src/msb.ts";

const conf = { mcpServers: { tracker: { type: "stdio", command: "node", args: ["/opt/tracker.mjs"], env: { TRACKER_TOKEN: "s3cret" } } } };
const noSh = spawnSync("sh", ["-c", "true"]).status !== 0;

test("flag: codeMode is 'on' or absent, an override wins, a typo is an error", () => {
  assert.equal(normalizeAgentPrefs({ defaultAgent: "claude", codeMode: "on" }).codeMode, "on");
  assert.equal(normalizeAgentPrefs({ defaultAgent: "claude", codeMode: "off" }).codeMode, undefined, "off is the default, not stored");
  assert.equal(normalizeAgentPrefs({ defaultAgent: "claude" }).codeMode, undefined);
  assert.equal(normalizeAgentPrefs({ codeMode: "" }).codeMode, undefined);
  assert.throws(() => normalizeAgentPrefs({ codeMode: "yes" }), /codeMode must be one of: on, off/);
  assert.equal(codeModeEnabled(undefined), false);
  assert.equal(codeModeEnabled({}), false);
  assert.equal(codeModeEnabled({ codeMode: "on" }), true);
  assert.equal(codeModeEnabled({ codeMode: "on" }, "off"), false);
  assert.equal(codeModeEnabled({}, "on"), true);
});

test("the prompt paragraph is the bench's (bench/code-mode/code-mode-prompt.txt), without the 24k cut", () => {
  const bench = readFileSync(new URL("../bench/code-mode/code-mode-prompt.txt", import.meta.url), "utf8").trim();
  assert.equal(CODE_MODE_PROMPT, bench);
  assert.doesNotMatch(CODE_MODE_PROMPT, /24k/);
});

test("wrapper config: one stdio server named code-mode, never deferred", () => {
  assert.deepEqual(codeModeWrapperConfig(), {
    mcpServers: {
      "code-mode": {
        type: "stdio",
        command: "node",
        args: ["/root/.claude/code-mode/server.js", "/root/.agent-mcp.upstream.json"],
        env: { R: "/usr/local/lib/node_modules" },
        alwaysLoad: true,
      },
    },
  });
});

test("install plan, code mode off: the direct config as before, and a stale upstream file is removed", () => {
  const sh = mcpInstallSh({ conf, specs: [] });
  assert.ok(sh.startsWith(`printf '%s' '${JSON.stringify(conf)}' > ${MCP_CONFIG_PATH} && chmod 600 ${MCP_CONFIG_PATH}`));
  assert.ok(sh.includes(`; rm -f ${CODE_MODE_UPSTREAM_PATH}`));
  assert.doesNotMatch(sh, /code-mode|--check/);
});

test("install plan, code mode on: upstream (600, deny list) + rewrite + check, omp keeps the direct servers", () => {
  const sh = mcpInstallSh({ conf, specs: ["some-mcp@1.0.0"], codeMode: { on: true } });
  const direct = `printf '%s' '${JSON.stringify(conf)}'`;
  assert.ok(sh.includes(`${direct} > ${OMP_MCP_CONFIG_PATH}`), "omp gets the direct config");
  assert.ok(sh.includes(`(umask 077; printf '%s' '${JSON.stringify({ ...conf, codeMode: { deny: [] } })}' > ${CODE_MODE_UPSTREAM_PATH}) && chmod 600 ${CODE_MODE_UPSTREAM_PATH}`));
  assert.ok(sh.includes(`${MCP_CONFIG_PATH} ${OMP_MCP_CONFIG_PATH} ${CODE_MODE_UPSTREAM_PATH} || true`), "the npx→bin rewrite reaches the upstream file");
  assert.ok(sh.includes(`node ${CODE_MODE_SERVER} --check ${CODE_MODE_UPSTREAM_PATH}`));
  // The file writer is the first thing in the braces: it reads stdin to the end, before npm runs.
  assert.match(sh, /; \{ node -e '[^']*fs\.readFileSync\(0/);
  assert.ok(sh.indexOf("fs.readFileSync(0") < sh.indexOf("npm i -g"));
  assert.ok(sh.indexOf("--check") > sh.indexOf(`${CODE_MODE_UPSTREAM_PATH} || true`), "the check runs after the rewrite");
  if (!noSh) assert.equal(spawnSync("sh", ["-n", "-c", sh]).status, 0, "valid sh");
});

test("install plan, flag on but no build to ship: the direct config and a note", () => {
  const sh = mcpInstallSh({ conf, specs: [], codeMode: { unavailable: "ENOENT (no such file)" } });
  assert.ok(sh.includes(`echo 'code-mode: fallback (ENOENT  no such file )'`));
  assert.doesNotMatch(sh, /--check/);
});

/** Run the plan in sh with /root/ moved under a temp dir, the code-mode files on stdin. */
function runInstall(stub: string) {
  const root = mkdtempSync(join(tmpdir(), "cm-install-")).replace(/\\/g, "/");
  mkdirSync(`${root}/.omp/agent`, { recursive: true });
  const sh = mcpInstallSh({ conf, specs: [], codeMode: { on: true } }).replaceAll("/root/", `${root}/`);
  const files = [
    { name: "package.json", contents: '{"type":"module"}\n' },
    { name: "server.js", contents: stub },
    { name: "prompt.txt", contents: CODE_MODE_PROMPT + "\n" },
  ];
  const out = execFileSync("sh", ["-c", sh], { input: codeModePayload(files), encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
  const at = (p: string) => p.replace("/root/", `${root}/`);
  return { out, at, read: (p: string) => readFileSync(at(p), "utf8") };
}

test("install, for real: --check passes → the wrapper; the upstream file has the servers", { skip: noSh }, () => {
  const r = runInstall('if (process.argv[2] === "--check") { console.log("sdk: /x/server/index.js"); process.exit(0); }\n');
  const cfg = JSON.parse(r.read(MCP_CONFIG_PATH));
  assert.deepEqual(Object.keys(cfg.mcpServers), ["code-mode"]);
  assert.equal(cfg.mcpServers["code-mode"].alwaysLoad, true);
  assert.deepEqual(JSON.parse(r.read(CODE_MODE_UPSTREAM_PATH)), { ...conf, codeMode: { deny: [] } });
  assert.deepEqual(JSON.parse(r.read(OMP_MCP_CONFIG_PATH)), conf);
  assert.ok(existsSync(r.at("/root/.claude/code-mode/prompt.txt")));
  assert.deepEqual(mcpInstallNotes(r.out), []);
  assert.match(r.out, /^mcp-baked:/m);
});

test("install, for real: --check fails → the direct config stays, the note names why", { skip: noSh }, () => {
  const r = runInstall(
    'console.log("sdk: missing — @modelcontextprotocol/sdk is not installed (looked next to the server and under /usr/local/lib/node_modules/): Cannot find module");\nconsole.log("server tracker: stdio");\nprocess.exit(1);\n'
  );
  assert.deepEqual(JSON.parse(r.read(MCP_CONFIG_PATH)), conf);
  const notes = mcpInstallNotes(r.out);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^code-mode: fallback \(sdk: missing — @modelcontextprotocol\/sdk is not installed looked next to the server/);
  assert.match(notes[0], /\)$/);
  assert.equal(r.read(MCP_NOTES_PATH).trim(), notes[0]);
  rememberProvision("box-cm", [...notes, "mcp-drop:x"]);
  const last = mcpProvisionState().last!;
  assert.match(last.codeModeFallback!, /^sdk: missing/);
  assert.deepEqual(last.dropped, ["x"]);
  // node itself failing (a syntax error in the shipped file) is a fallback too, with the error line.
  const broken = runInstall("this is not javascript(\n");
  assert.deepEqual(JSON.parse(broken.read(MCP_CONFIG_PATH)), conf);
  assert.match(mcpInstallNotes(broken.out)[0] ?? "", /^code-mode: fallback \(.*Error/);
});

test("launch: --allowedTools derives mcp__code-mode from the wrapper config; the paragraph is appended only for it", () => {
  const sh = claudeLaunchSh(false);
  const prog = sh.match(/node -e '(const c=require[^']*)'/)?.[1];
  assert.ok(prog, "the allowed-tools derivation is a node -e program");
  const dir = mkdtempSync(join(tmpdir(), "cm-launch-"));
  const file = join(dir, "agent-mcp.json");
  writeFileSync(file, JSON.stringify(codeModeWrapperConfig()));
  const js = prog.replaceAll('\\"', '"').replace(MCP_CONFIG_PATH, file.replace(/\\/g, "/"));
  assert.equal(execFileSync(process.execPath, ["-e", js], { encoding: "utf8" }), "mcp__code-mode");
  assert.ok(
    sh.startsWith(
      `if grep -qsF ${CODE_MODE_SERVER} ${MCP_CONFIG_PATH} && [ -s /root/.claude/code-mode/prompt.txt ]; then AGENT_SYS_PROMPT="$AGENT_SYS_PROMPT $(cat /root/.claude/code-mode/prompt.txt)"; fi; `
    )
  );
  assert.ok(sh.indexOf("AGENT_SYS_PROMPT=") < sh.indexOf('--append-system-prompt "$AGENT_SYS_PROMPT"'));
});
