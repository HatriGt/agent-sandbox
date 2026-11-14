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

/**
 * Matched against ABSOLUTE paths (see absPath). `.claude` is control only as the box user's own
 * (~/.claude: hooks, settings, skills; ~/.claude.json: MCP servers). A repo's `.claude/` under
 * /workspace is inert — claude runs with `--setting-sources user`, so its settings and hooks are
 * never loaded — and editing one (a slash command, an agent, the repo's settings) is ordinary work.
 */
const CONTROL_PATHS = [
  /^(\/root|\/home\/[^/]+)?\/\.claude(\/|$)/, // hooks + settings that implement the pause/guard
  /^(\/root|\/home\/[^/]+)?\/\.claude\.json$/, // Claude Code's user config (MCP servers)
  /(^|\/)\.agent-mcp\.json$/, // MCP server secrets
  /(^|\/)\.agent\.(log|task|run|done)$/, // the controller's channel (the question file is allowed)
  /(^|\/)\.git-credentials$/,
  /(^|\/)\.claimed$/,
];

const SECRET_NAMES = /(GH_TOKEN|GITHUB_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|\.git-credentials|\.agent-mcp\.json|AGENT_SYS_PROMPT)/;
const NETWORK_TOOLS = /\b(curl|wget|nc|ncat|netcat|socat|scp|sftp|rsync|ssh|telnet|openssl\s+s_client|python3?\s+-c|node\s+-e|http\s)\b/;
// `set` dumps only as a bare command; as a word it is everywhere (`echo '{"op":"set"}' | curl localhost`).
const ENV_DUMP = /\b(printenv|env|export\s*$|declare\s+-x|cat\s+\/proc\/(self|\d+)\/environ)\b|(^|[;&|(]\s*)set\s*(\||$)/;
const PIPE_TO_NETWORK = /\|\s*(curl|wget|nc|ncat|socat|ssh|openssl)\b/;
const DESTRUCTIVE_ROOT = /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|\/\*|\/root|\/usr|\/etc|\/var|~|\$HOME)(\s|$)/;
// chmod on a control path is writesControlPath's job: the old `chmod [0-7]* .*\.claude` here matched
// `chmod 755 build.sh && cat ~/.claude/skills/x/SKILL.md`. `crontab -l` only lists.
const DISABLE_CONTROLS = /\b(claude\s+mcp\s+(add|add-json|remove)|chattr\s|crontab\s+(-[re]\b|[^-\s]))/;

/**
 * Claude Code's auto-memory lives INSIDE ~/.claude (projects/<slug>/memory/*.md + MEMORY.md), and
 * writing remembered facts there is legitimate agent behaviour, not a control-plane change — the
 * hooks and settings that implement the guard live elsewhere in the tree. Denying it taught agents
 * to announce "my memory is locked down" on every run. Markdown under memory/ is inert context.
 */
const MEMORY_PATH = /^\/(root|home\/[^/]+)\/\.claude\/projects\/[^/]+\/memory(\/|$)/;

/** Boxes run as root. */
const HOME = "/root";
/** Where the agent's commands start: the workdir is /workspace or a repo under it. */
const WORKSPACE = "/workspace";

/** A shell word or tool path as the absolute path it names: quotes peeled, ~/$HOME expanded, relative
 *  resolved against cwd, `.`/`..` folded (so memory/../../settings.json is not "memory"). */
function absPath(word: string, cwd: string): string {
  let p = word.replace(/^["'(]+|["'),;]+$/g, "");
  p = p.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, HOME);
  if (!p.startsWith("/")) p = cwd + "/" + p;
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

function isControlPath(p: string, cwd: string): boolean {
  const abs = absPath(p, cwd);
  return !MEMORY_PATH.test(abs) && CONTROL_PATHS.some((re) => re.test(abs));
}

/** Does any word of s (or the value of a `--flag=path` / `of=path` word) name a control path? */
function touchesControlPath(s: string, cwd?: string): boolean {
  const dir = cwd || WORKSPACE;
  return s.split(/\s+/).filter(Boolean).some((w) => [w, ...w.split("=").slice(1)].some((x) => x && isControlPath(x, dir)));
}

/** Commands that change or remove whatever path they are given. */
const MUTATE_ANY = /^(rm|rmdir|mv|chmod|chown|chattr|truncate|tee|unlink|shred)$/;
/** Commands that write only their LAST path argument (the destination); reading the sources is fine. */
const MUTATE_DEST = /^(cp|install|ln|rsync)$/;

/**
 * Does this shell command WRITE a control path? Reading one is fine: skills live under
 * ~/.claude/skills, and `cat ~/.claude/skills/x/SKILL.md 2>/dev/null` or `node ~/.claude/skills/x/run.mjs
 * 2>&1` are how an agent uses them. The old test denied any command that named a control path and
 * held a `>` anywhere, so a stderr redirect made reading a skill "changing the control files".
 *
 * Per segment (split on ; && || | and newlines): a `>`/`>>` whose target is a control path; a
 * MUTATE_ANY command with a control path among its arguments; a MUTATE_DEST command whose destination
 * is one; `sed -i`/`perl -i` on one; `dd of=` one; `find … -delete|-exec rm` over one. Variables set
 * earlier in the command (`S=~/.claude/settings.json; rm $S`) are expanded first, so the indirection
 * does not hide a write.
 */
function writesControlPath(cmd: string): boolean {
  const vars: Record<string, string> = {};
  let cwd = WORKSPACE;
  for (const raw of cmd.split(/\|\||&&|[;|\n]/)) {
    const seg = raw.replace(/\$\{?(\w+)\}?/g, (m: string, n: string) => (n === "HOME" ? m : n in vars ? vars[n] : m));
    // Relative paths resolve against the directory the command has moved to (also inside `bash -c "cd ~ && …"`).
    const cd = /(?:^|[\s"'(])(?:cd|pushd)(?:\s+([^\s;&|"')]+))?\s*["')]*\s*$/.exec(seg);
    if (cd) cwd = cd[1] ? absPath(cd[1], cwd) : HOME;
    for (const m of seg.matchAll(/(?:^|[^<>&\d])\d*>{1,2}\|?\s*([^\s<>&|;]+)/g)) {
      if (touchesControlPath(m[1], cwd)) return true;
    }
    const words = seg.trim().split(/\s+/).filter(Boolean);
    while (words.length && /^\w+=/.test(words[0])) {
      const eq = words[0].indexOf("=");
      vars[words[0].slice(0, eq)] = words[0].slice(eq + 1).replace(/^["']|["']$/g, "");
      words.shift();
    }
    while (words.length && /^(sudo|env|command|exec|nohup|time|xargs)$/.test(words[0])) words.shift();
    if (!words.length) continue;
    const name = words[0].split("/").pop() || "";
    const args = words.slice(1);
    const paths = args.filter((a) => !a.startsWith("-"));
    if (MUTATE_ANY.test(name) && args.some((a) => touchesControlPath(a, cwd))) return true;
    if (MUTATE_DEST.test(name) && paths.length && touchesControlPath(paths[paths.length - 1], cwd)) return true;
    if ((name === "sed" || name === "perl") && args.some((a) => /^-\w*i/.test(a)) && args.some((a) => touchesControlPath(a, cwd))) return true;
    if (name === "dd" && args.some((a) => a.startsWith("of=") && touchesControlPath(a.slice(3), cwd))) return true;
    if (name === "find" && /\s-(delete|exec\s+(rm|mv|chmod|truncate|tee))\b/.test(seg) && touchesControlPath(seg, cwd)) return true;
  }
  return false;
}

export function guardDecision(tool: string, input: Record<string, unknown> | undefined): GuardDecision {
  const inp = input ?? {};
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const path = String(inp.file_path ?? inp.notebook_path ?? inp.path ?? "");
    if (path && isControlPath(path, WORKSPACE)) {
      return { deny: true, reason: `Refusing to modify ${path}: it is part of the sandbox's control plane (hooks, credentials, or the controller's channel). Continue the task without touching it.` };
    }
    return { deny: false };
  }
  if (tool === "Bash") {
    const cmd = String(inp.command ?? "");
    const flat = cmd.replace(/\s+/g, " ");
    // 1. Editing or deleting the control plane through the shell (reading it, e.g. a skill, is fine).
    if (writesControlPath(cmd)) {
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
    `const MUTATE_ANY=${String(MUTATE_ANY)};`,
    `const MUTATE_DEST=${String(MUTATE_DEST)};`,
    `const MEMORY_PATH=${String(MEMORY_PATH)};`,
    `const HOME=${JSON.stringify(HOME)};`,
    `const WORKSPACE=${JSON.stringify(WORKSPACE)};`,
    absPath.toString(),
    isControlPath.toString(),
    touchesControlPath.toString(),
    writesControlPath.toString(),
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
