/**
 * The ASK lane — a read-only co-pilot that answers questions about a box WITHOUT touching the
 * driver agent.
 *
 * Two lanes share one box and one filesystem, and are otherwise isolated:
 *   - DRIVER lane  — the delegated agent: /workspace, the .agent.* sentinels, the ask-gate hook,
 *                    the `-c` Claude session rooted at the repo workdir. Owned by delegate/resume.
 *   - ASK lane     — a second, short-lived Claude run rooted at /ask. It reads the workspace and the
 *                    driver's log, answers YOU, and is never fed back into the driver's context.
 *
 * Three invariants make "talk to it without stopping it" true rather than merely hoped for:
 *
 *  1. SEPARATE SESSION BUCKET. Claude Code keys its resumable sessions by cwd. If the ask lane ran
 *     in the repo workdir, `claude -c` would make the ASK turn the most recent session there and the
 *     next `resume` would continue the wrong conversation. Rooting the ask lane at ${ASK_DIR} gives
 *     it its own bucket, so both lanes can use `-c` and never collide.
 *  2. NO SHARED STATE. Ask artifacts live under ${ASK_DIR}, outside /workspace — so the repo tree
 *     stays clean, `monitor`/`watch` never surface ask chatter, and nothing lands in a PR.
 *  3. READ-ONLY, ENFORCED. A PreToolUse hook denies edit tools and mutating shell commands in this
 *     lane (see `askGateDecision`). Best-effort by nature (a shell is a shell), but it hard-blocks
 *     the two things that would actually corrupt the driver: writes to the .agent.* sentinels — a
 *     forged question would freeze the driver via its own ask-gate — and git state changes.
 *
 * Everything in this file is pure so it can be unit-tested without a VPS; msb.ts turns it into an
 * `msb exec`. The in-box hook is generated from the SAME predicate the tests exercise
 * (`askGateDecision`), so the gate can't drift from its tests.
 */

/** Co-pilot lane root: Claude session bucket + transcript. Deliberately OUTSIDE /workspace. */
export const ASK_DIR = "/ask";
/** Append-only transcript of every ask turn, for auditing what the co-pilot was told/asked. */
export const ASK_LOG = `${ASK_DIR}/.ask.log`;
/** Marker proving a prior ask turn exists in this bucket, so `-c` has something to continue. */
export const ASK_THREAD_MARK = `${ASK_DIR}/.ask.thread`;
/**
 * Env flag that tells the two in-box hooks which lane they're running in. Set on ask execs only:
 * the driver's ask-gate skips when it's set, the read-only gate skips when it isn't.
 */
export const ASK_LANE_ENV = "ASK_LANE";

/** Tools the co-pilot may use. Read/Glob/Grep are inherently read-only; Bash is gated below. */
export const ASK_ALLOWED_TOOLS = "Read Glob Grep Bash";

/**
 * Shell constructs that mutate state. Matched against the WHOLE Bash command (all segments), so a
 * mutation hidden behind `;`, `&&`, or a pipe is still caught.
 *
 * Deliberately broad: a false deny costs the co-pilot one alternative phrasing, while a false allow
 * can corrupt a running delegation. `>`/`>>` are included because a redirect is the cheapest way to
 * write a file; `git add/commit/checkout/...` because they move the driver's HEAD or index under it.
 */
export const MUTATING_BASH_RE =
  /(^|[;&|`]|\$\()\s*(sudo\s+)?(rm|mv|cp|ln|mkdir|rmdir|touch|chmod|chown|dd|truncate|tee|kill|pkill|killall|shutdown|reboot|apt|apt-get|npm|pnpm|yarn|pip|pip3|make|nohup)\b|\bsed\b[^|;&]*\s-i\b|\bgit\s+(?:-[A-Za-z-]+\s+(?:[^-\s]\S*\s+)?)*(add|commit|checkout|switch|reset|revert|merge|rebase|push|pull|fetch|apply|clean|stash|restore|rm|mv|tag|branch)\b|\bgh\s+(pr|issue|release|repo|api)\b[^|;&]*\s-(X|-method)\s|>>?[^&]/;

/** Paths whose contents drive the DRIVER lane. Writing any of them from the ask lane is fatal. */
export const PROTECTED_PATH_RE = /\/workspace\/\.agent\.|\/ask\b|\.claude\/(settings|hooks)/;

/** Edit-family tools: never available to the co-pilot, whatever the arguments say. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "Update"]);

/** The PreToolUse payload we care about (extra fields are ignored). */
export interface AskGateInput {
  tool_name?: string;
  tool_input?: { command?: string; file_path?: string; path?: string };
}

/** A gate verdict: allow silently, or deny with a reason the co-pilot can act on. */
export interface AskGateVerdict {
  deny: boolean;
  reason?: string;
}

const ALLOW: AskGateVerdict = { deny: false };

/**
 * Decide whether a co-pilot tool call is read-only. Denials carry a reason that names the read-only
 * alternative, so the model retries usefully instead of concluding it is broken.
 */
export function askGateDecision(input: AskGateInput): AskGateVerdict {
  const tool = input.tool_name ?? "";
  const args = input.tool_input ?? {};

  if (WRITE_TOOLS.has(tool)) {
    return {
      deny: true,
      reason:
        `The ask lane is READ-ONLY: ${tool} is not available here. You are a co-pilot observing a ` +
        `running delegation — report what you found instead of changing it. If the operator wants a ` +
        `change, they will tell the driver agent via resume().`,
    };
  }

  // Note: there is deliberately no path check for the read tools. Driver-lane paths are protected
  // from WRITES (the edit tools above, and mutating shell below) — reading them is the co-pilot's
  // entire job, and .agent.log/.agent.question are the two most useful files in the box.
  if (tool === "Bash") {
    const cmd = args.command ?? "";
    if (PROTECTED_PATH_RE.test(cmd) && MUTATING_BASH_RE.test(cmd)) {
      return {
        deny: true,
        reason:
          `That command writes to driver-lane state (${ASK_DIR} or /workspace/.agent.*). Writing a ` +
          `question sentinel would FREEZE the running agent. Read it instead (cat/tail).`,
      };
    }
    if (MUTATING_BASH_RE.test(cmd)) {
      return {
        deny: true,
        reason:
          `The ask lane is READ-ONLY: that command mutates state (writes, installs, or moves git ` +
          `HEAD/index) while another agent is working in this box. Use read-only equivalents — ` +
          `cat, ls, grep, git status/diff/log/show — and report what you see.`,
      };
    }
  }

  return ALLOW;
}

/**
 * The co-pilot's standing prompt. It states the one thing the model cannot infer from the
 * filesystem: another agent is working here RIGHT NOW, and observing must not disturb it.
 */
export function askSystemPrompt(workdir: string, agentLog: string, questionMark: string): string {
  return (
    "You are the ASK co-pilot for an isolated sandbox in which ANOTHER agent (the 'driver') is " +
    "working on a task right now. Your job is to answer the operator's question about what is " +
    "happening, quickly and concretely. " +
    `The driver's repo(s) are under ${workdir}; its live log is ${agentLog} (tail it to see what it ` +
    `is doing this minute); if ${questionMark} exists, the driver is PAUSED waiting for an answer. ` +
    "You are STRICTLY READ-ONLY: never edit, create, or delete anything, never run installs or any " +
    "git command that changes HEAD, the index, or a remote. Read-only git (status, diff, log, show) " +
    "is encouraged — `git diff` is usually the fastest answer to 'what has it changed so far'. " +
    "A hook enforces this and will deny mutating calls; that is expected, not an error. " +
    "You CANNOT talk to the driver and must not try: you are a separate observer, and nothing you " +
    "say reaches it. If the operator wants to steer it, tell them to answer via resume(). " +
    "Ground every claim in something you actually read, cite the file or log line, and answer in a " +
    "few sentences — this is a glance over the shoulder, not a report."
  );
}

/**
 * The in-box PreToolUse hook body for the ask lane, generated from `askGateDecision` so the shipped
 * gate and the tested predicate are literally the same code path.
 *
 * Emitted as a node program: it reads the hook JSON on stdin and prints the deny contract (or
 * nothing, which means allow). Node is always present in the box image.
 */
export function askGateNodeProgram(): string {
  // Serialized as source so the box needs no bundler: the regexes and the decision table below
  // mirror askGateDecision exactly. Any change here must be mirrored in the tests above it.
  return [
    `let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{`,
    `let i={};try{i=JSON.parse(d)}catch(e){}`,
    `const t=i.tool_name||"",a=i.tool_input||{};`,
    `const W=${JSON.stringify([...WRITE_TOOLS])};`,
    `const M=new RegExp(${JSON.stringify(MUTATING_BASH_RE.source)});`,
    `const P=new RegExp(${JSON.stringify(PROTECTED_PATH_RE.source)});`,
    `let r=null;`,
    `if(W.indexOf(t)>=0)r="The ask lane is READ-ONLY: "+t+" is not available here. Report what you found instead of changing it.";`,
    `else if(t==="Bash"&&M.test(a.command||"")&&P.test(a.command||""))r="That command writes to driver-lane state; writing a question sentinel would FREEZE the running agent. Read it instead (cat/tail).";`,
    `else if(t==="Bash"&&M.test(a.command||""))r="The ask lane is READ-ONLY: that command mutates state while another agent is working in this box. Use cat, ls, grep, or git status/diff/log/show instead.";`,
    `if(r)process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:r}}));`,
    `});`,
  ].join("");
}

/** What one ask turn produced, before formatting. */
export interface AskResult {
  session: string;
  /** The co-pilot's answer text (already trimmed). */
  answer: string;
  /** True when the turn hit the time cap and was killed. */
  timedOut: boolean;
  /** The driver's run state at the moment of the ask, for context. */
  driverState?: string;
  /** True when this turn continued an existing ask thread. */
  continued: boolean;
}

/**
 * Render an ask turn. Leads with the driver's state — the answer means something different when the
 * driver is WAITING (paused, question pending) than when it is mid-run — then the answer itself.
 */
export function formatAsk(r: AskResult): string {
  const head = `ask (co-pilot, read-only) · session=${r.session}` + (r.continued ? " · same thread" : " · new thread");
  const state = r.driverState ? `driver: ${r.driverState}` : undefined;
  const body = r.answer || "(the co-pilot returned nothing)";
  const note = r.timedOut
    ? "\n\n(Time cap reached — the answer above may be partial. Ask a narrower question to get a full one.)"
    : "";
  const tail =
    "\n\nThe driver agent was NOT interrupted and did not see this exchange. To actually steer it, " +
    "answer its question with resume().";
  return [head, state, "", body].filter((l) => l !== undefined).join("\n").trim() + note + tail;
}
