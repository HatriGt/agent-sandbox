/**
 * The driver-lane guard: what the agent may NOT do inside its own sandbox, decided per tool call.
 *
 * Threat model (docs/security.md): the microVM is the hard boundary — nothing here protects the host,
 * KVM does. What CAN go wrong inside is (a) a prompt-injected agent exfiltrating the credentials the
 * box legitimately holds (GH token, MCP secrets) to somewhere on the internet, (b) the agent
 * disabling its own controls (this hook, the ask-gate, the control sentinels) so the operator loses
 * the pause/answer loop, and (c) self-destruction that wastes the run. This guard is a deterministic
 * PreToolUse hook — no model in the loop — so it cannot be talked out of a decision.
 *
 * It is a narrow allow-by-default list of denials, not a sandbox: refusing too much makes the agent
 * useless, and the VM already contains the blast radius. Pure; unit-tested; the shell wrapper only
 * pipes stdin JSON in and the decision out.
 */

export interface GuardDecision {
  deny: boolean;
  reason?: string;
}

const CONTROL_PATHS = [
  /(^|\/)\.claude(\/|$)/, // hooks + settings that implement the pause/guard
  /(^|\/)\.agent-mcp\.json$/, // MCP server secrets
  /(^|\/)\.agent\.(log|task|run|done)$/, // the controller's channel (the question file is allowed)
  /(^|\/)\.git-credentials$/,
  /(^|\/)\.claimed$/,
];

const SECRET_NAMES = /(GH_TOKEN|GITHUB_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|\.git-credentials|\.agent-mcp\.json|AGENT_SYS_PROMPT)/;
const NETWORK_TOOLS = /\b(curl|wget|nc|ncat|netcat|socat|scp|sftp|rsync|ssh|telnet|openssl\s+s_client|python3?\s+-c|node\s+-e|http\s)\b/;
const ENV_DUMP = /\b(printenv|env|set|export\s*$|declare\s+-x|cat\s+\/proc\/(self|\d+)\/environ)\b/;
const PIPE_TO_NETWORK = /\|\s*(curl|wget|nc|ncat|socat|ssh|openssl)\b/;
const DESTRUCTIVE_ROOT = /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|\/\*|\/root|\/usr|\/etc|\/var|~|\$HOME)(\s|$)/;
const DISABLE_CONTROLS = /\b(claude\s+mcp\s+(add|remove)|chattr\s|chmod\s+[0-7]*\s+.*\.claude|crontab\s+-)/;

/**
 * Claude Code's auto-memory lives INSIDE ~/.claude (projects/<slug>/memory/*.md + MEMORY.md), and
 * writing remembered facts there is legitimate agent behaviour, not a control-plane change — the
 * hooks and settings that implement the guard live elsewhere in the tree. Denying it taught agents
 * to announce "my memory is locked down" on every run. Markdown under memory/ is inert context.
 */
const MEMORY_PATH = /(^|[/\s])[\w~./-]*\.claude\/projects\/[^/\s]+\/memory(\/[^\s]*)?/g;

function touchesControlPath(s: string): boolean {
  // Blank out memory paths first so a command touching BOTH memory and, say, settings.json is
  // still judged on the settings.json part alone.
  const rest = s.replace(MEMORY_PATH, " ");
  return CONTROL_PATHS.some((re) => re.test(rest));
}

export function guardDecision(tool: string, input: Record<string, unknown> | undefined): GuardDecision {
  const inp = input ?? {};
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const path = String(inp.file_path ?? inp.notebook_path ?? inp.path ?? "");
    if (touchesControlPath(path)) {
      return { deny: true, reason: `Refusing to modify ${path}: it is part of the sandbox's control plane (hooks, credentials, or the controller's channel). Continue the task without touching it.` };
    }
    return { deny: false };
  }
  if (tool === "Bash") {
    const cmd = String(inp.command ?? "");
    const flat = cmd.replace(/\s+/g, " ");
    // 1. Editing or deleting the control plane through the shell.
    if (/(>>?|\btee\b|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b|\bchmod\b|\btruncate\b)/.test(flat) && touchesControlPath(flat)) {
      return { deny: true, reason: "Refusing to change the sandbox's control files (~/.claude, .agent.*, credentials). Work in /workspace only." };
    }
    if (DISABLE_CONTROLS.test(flat)) {
      return { deny: true, reason: "Refusing to reconfigure the agent runtime from inside the sandbox. Ask the operator to change MCP servers or hooks on the dashboard." };
    }
    // 2. Credential exfiltration: a secret name and a network tool in the same command, or an
    //    environment dump piped to the network.
    if (SECRET_NAMES.test(flat) && NETWORK_TOOLS.test(flat)) {
      return { deny: true, reason: "Refusing to send credentials or agent secrets over the network. Use `gh`/`git` for GitHub; never post tokens anywhere." };
    }
    if (ENV_DUMP.test(flat) && PIPE_TO_NETWORK.test(flat)) {
      return { deny: true, reason: "Refusing to pipe the environment to a network tool." };
    }
    // 3. Self-destruction of the runtime (not the workspace — that is the agent's to change).
    if (DESTRUCTIVE_ROOT.test(flat)) {
      return { deny: true, reason: "Refusing to delete the sandbox's system directories. Changes belong under /workspace." };
    }
    return { deny: false };
  }
  return { deny: false };
}

/**
 * The node program installed as ~/.claude/hooks/guard.js: reads Claude Code's PreToolUse JSON on
 * stdin and emits a deny decision when guardDecision says so. Self-contained (no imports) because it
 * runs inside the box; the regexes are serialised from this module so the tests and the box agree.
 */
export function guardNodeProgram(): string {
  const src = guardDecision.toString();
  const consts = [
    `const CONTROL_PATHS=[${CONTROL_PATHS.map(String).join(",")}];`,
    `const SECRET_NAMES=${String(SECRET_NAMES)};`,
    `const NETWORK_TOOLS=${String(NETWORK_TOOLS)};`,
    `const ENV_DUMP=${String(ENV_DUMP)};`,
    `const PIPE_TO_NETWORK=${String(PIPE_TO_NETWORK)};`,
    `const DESTRUCTIVE_ROOT=${String(DESTRUCTIVE_ROOT)};`,
    `const DISABLE_CONTROLS=${String(DISABLE_CONTROLS)};`,
    `const MEMORY_PATH=${String(MEMORY_PATH)};`,
    `function touchesControlPath(s){const rest=s.replace(MEMORY_PATH," ");return CONTROL_PATHS.some(re=>re.test(rest))}`,
  ].join("\n");
  return (
    `${consts}\n${src}\n` +
    `let buf="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>buf+=d);process.stdin.on("end",()=>{` +
    `let e={};try{e=JSON.parse(buf)}catch(_){}` +
    `const d=guardDecision(String(e.tool_name||""),e.tool_input||{});` +
    `if(d.deny){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:d.reason}}))}` +
    `process.exit(0)});`
  );
}
