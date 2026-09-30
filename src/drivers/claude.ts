/**
 * The Claude Code driver — the reference implementation of the Driver contract. Every piece here
 * was moved verbatim out of src/msb.ts; test/drivers-claude.test.ts pins the emitted shell
 * byte-for-byte against the pre-extraction output.
 */
import { shellQuote } from "../exec.js";
import { ASK_LANE_ENV, askGateNodeProgram } from "../ask.js";
import { guardNodeProgram } from "../guard.js";
import { redactShapesSource } from "../redact.js";
import {
  AGENT_LOG,
  AT_MARK,
  DIFF_CLOSE,
  DIFF_MAX_BYTES,
  DIFF_MAX_LINES,
  DIFF_OPEN,
  ERR_MARK,
  ID_CLOSE,
  ID_OPEN,
  MCP_CONFIG_PATH,
  PLAN_CLOSE,
  PLAN_OPEN,
  QUESTION_MARK,
  RESULT_MAX_BYTES,
  RESULT_MAX_LINES,
  RESULT_MAX_LINE_CHARS,
  THINK_CLOSE,
  THINK_OPEN,
  USAGE_OPEN,
} from "./sentinels.js";
import { AGENT_SYS_PROMPT } from "./prompts.js";
import type { Driver } from "./types.js";

/**
 * Version-aware Claude Code install: (re)install iff the installed version differs from the pin.
 * A bare `command -v claude ||` guard meant a baked snapshot NEVER upgraded — the pin has to be
 * consulted against `claude --version` (whose output is "X.Y.Z (Claude Code)") every time. The
 * version string is validated here because it lands inside a shell command.
 */
export function claudeInstallSh(version: string): string {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`invalid Claude Code version: ${JSON.stringify(version)}`);
  return (
    `[ "$(claude --version 2>/dev/null | cut -d' ' -f1)" = "${version}" ] || ` +
    `npm i -g @anthropic-ai/claude-code@${version}`
  );
}

/**
 * Install our USER-scope Claude hook that turns "ask a question" into a real, enforced pause.
 *
 * Why a hook: `claude -p` never blocks — writing the question file alone doesn't stop Claude; it
 * writes then keeps working and self-answers (observed). Claude Code's documented lever is a
 * PreToolUse hook returning permissionDecision:"deny": once the agent has written the question
 * sentinel, the hook DENIES every subsequent tool call, so Claude cannot do any more work and its
 * turn ends cleanly at the question. The run then shows run:waiting; `resume` (claude -c) deletes
 * the sentinel (see agentSh) and the next turn's tool calls are allowed again.
 *
 * Installed at ~/.claude (user scope) so `--setting-sources user` loads it (project settings are
 * intentionally skipped). Idempotent: overwrites the files each bootstrap.
 */
export function askHookScript(): string {
  // The hook: if the question sentinel exists, DENY the pending tool call with a clear reason; else
  // allow. Reads the PreToolUse JSON on stdin (we don't need its fields — presence of the sentinel
  // is the whole decision). Uses node (always present in the image) to emit the exact JSON contract.
  const hook =
    `#!/bin/sh\n` +
    // Driver lane only. The ASK co-pilot runs in the same box with the same user settings, so it
    // would otherwise be frozen by the driver's pending question — exactly when you most want to ask
    // "what is it stuck on?". The lane flag is set on ask execs only (see askInBox).
    `if [ -n "$${ASK_LANE_ENV}" ]; then exit 0; fi\n` +
    `if [ -f ${QUESTION_MARK} ]; then\n` +
    `  node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"A question is pending in ${QUESTION_MARK} and is awaiting the caller. Do NOT take any further action or guess an answer — end your turn now. It will be resumed with the answer."}}))'\n` +
    `fi\n` +
    `exit 0\n`;
  // The ask lane's read-only gate: the mirror image of the ask-gate — it runs ONLY when the lane
  // flag is set, and denies anything that would mutate the box under the working driver.
  const roHook =
    `#!/bin/sh\n` +
    `if [ -z "$${ASK_LANE_ENV}" ]; then exit 0; fi\n` +
    `exec node "$HOME/.claude/hooks/ask-ro.js"\n`;
  // The driver-lane guard (src/guard.ts): deterministic denials for control-plane edits, credential
  // exfiltration and runtime self-destruction. The ask lane is already read-only.
  const guardHook =
    `#!/bin/sh\n` +
    `if [ -n "$${ASK_LANE_ENV}" ]; then exit 0; fi\n` +
    `exec node "$HOME/.claude/hooks/guard.js"\n`;

  const settings = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            { type: "command", command: "$HOME/.claude/hooks/ask-gate.sh" },
            { type: "command", command: "$HOME/.claude/hooks/ask-ro.sh" },
            { type: "command", command: "$HOME/.claude/hooks/guard.sh" },
          ],
        },
      ],
    },
  });
  // The gate program is base64'd for the same reason as stream-fmt.js: a raw JS blob does not
  // survive shell + SSH + msb-exec quoting intact.
  const roB64 = Buffer.from(askGateNodeProgram(), "utf8").toString("base64");
  const guardB64 = Buffer.from(guardNodeProgram(), "utf8").toString("base64");
  return (
    `mkdir -p "$HOME/.claude/hooks" && ` +
    `printf '%s' ${shellQuote(hook)} > "$HOME/.claude/hooks/ask-gate.sh" && ` +
    `chmod +x "$HOME/.claude/hooks/ask-gate.sh" && ` +
    `printf '%s' ${shellQuote(roHook)} > "$HOME/.claude/hooks/ask-ro.sh" && ` +
    `chmod +x "$HOME/.claude/hooks/ask-ro.sh" && ` +
    `printf '%s' '${roB64}' | base64 -d > "$HOME/.claude/hooks/ask-ro.js" && ` +
    `printf '%s' ${shellQuote(guardHook)} > "$HOME/.claude/hooks/guard.sh" && ` +
    `chmod +x "$HOME/.claude/hooks/guard.sh" && ` +
    `printf '%s' '${guardB64}' | base64 -d > "$HOME/.claude/hooks/guard.js" && ` +
    // Merge the hook into any existing user settings.json (don't clobber other keys).
    `node -e 'const fs=require("fs"),os=require("os"),p=require("path");const f=p.join(os.homedir(),".claude","settings.json");let j={};try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){}const add=${JSON.stringify(JSON.parse(settings))};j.hooks=Object.assign({},j.hooks,add.hooks);fs.writeFileSync(f,JSON.stringify(j,null,2))'`
  );
}

/**
 * Install the stream-json → human-log formatter at ~/.claude/stream-fmt.js.
 *
 * Headless `claude -p` buffers plain output and flushes at the very end, so the dashboard terminal
 * shows nothing mid-run. With `--output-format stream-json --verbose` Claude emits one JSON event per
 * line (system init, assistant text, tool_use, tool_result, final result) as they happen. This
 * formatter tails that NDJSON on stdin and appends readable lines to the log (argv[1]) in real time —
 * so the terminal panel streams tool calls and messages live. It also re-emits the final result text
 * so `status`/completion still sees the summary. Pure Node (always in the image); no deps.
 */

export function streamFmtScript(): string {
  const js =
    `const fs=require("fs");` +
    `const out=process.argv[2];` +
    // Shape-redaction at WRITE time (src/redact.ts, serialized): .agent.log lives in the
    // agent-readable workspace, so a credential leaked into tool output must never persist there —
    // controller-side redaction only protects what is SERVED, not the on-disk copy.
    `${redactShapesSource()}\n` +
    `function w(s){try{fs.appendFileSync(out,redactShapes(String(s))+"\\n")}catch(e){}}` +
    // Defang transcript sentinels in MODEL-PRODUCED content before it reaches the log. The trace
    // parser treats a column-0 ⟦you⟧/⟦ask⟧/⟦think⟧/⟦plan⟧ or a line-leading ● as structure, and
    // assistant text is written at column 0 — so a prompt-injected agent could forge the record a
    // human reviews: a fake operator-approval bubble, a fake question, a fake "session started".
    // (The resume echo is defanged host-side the same way — see DEFANG_SENTINELS_SED.) A zero-width
    // space before each ⟦ and each line-leading ● breaks the parse while reading identically to a
    // human. The formatter's OWN sentinels are appended after this, so real structure is untouched.
    // A column-0 `→ Name: arg` is also structure (a tool-call row): without defanging it, injected
    // prose could forge authentic-looking tool cards (`→ Bash: git push …`) and fake Write rows that
    // feed the produced-files artifact cards. Same zero-width-space treatment.
    `function df(s){return String(s).replace(/\\u27e6/g,"\\u200b\\u27e6").replace(/^\\u25cf/gm,"\\u200b\\u25cf").replace(/^\\u2192/gm,"\\u200b\\u2192")}` +
    `function st(){w("${AT_MARK} "+Date.now())}` +
    `let buf="";` +
    // Every assistant text block already written, so the run's final `result` (which IS one of them,
    // normally the last) is not appended a second time.
    `const seenText=new Set();` +
    // Whether the "session started" marker has been written for this turn (see the init branch).
    `let inited=false;` +
    // Last per-request context footprint (input + cache + output of the most recent assistant
    // message) — the number that says how full the window is; the result frame's input counters
    // are CUMULATIVE across the turn and answer "what did this turn cost" instead.
    `let ctx=0;` +
    `function usum(u){return (u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0)}` +
    // tool_use ids of TodoWrite calls: their result ("Todos have been modified successfully") is
    // noise once the plan block itself is in the log, so it is not written.
    `const planIds=new Set();` +
    // Newer Claude Code has no TodoWrite: the plan is a task LIST built with TaskCreate/TaskUpdate,
    // whose calls carry one mutation each rather than the whole list. We keep the list here and emit
    // the same ⟦plan⟧ snapshot after every mutation, so downstream there is exactly one plan concept.
    // Ids are the creation order (`TaskCreate` → "Task #1 created successfully", and TaskUpdate is
    // called with taskId "1") — verified against a live box, not assumed.
    `const tasks=[];` +
    `function emitPlan(){const live=tasks.filter(t=>t.s!=="deleted");if(!live.length)return;` +
    `w("${PLAN_OPEN} "+Date.now()+"\\n"+live.map(t=>(t.s==="completed"?"[x] ":t.s==="in_progress"?"[>] ":"[ ] ")+t.t).join("\\n")+"\\n${PLAN_CLOSE}")}` +
    `function oneLine(v){return df(String(v==null?"":v).replace(/\\s*\\n\\s*/g," ").trim().slice(0,160))}` +
    // The -old/+new lines for an editing tool, or [] for anything else. MultiEdit folds each edit;
    // Write/NotebookEdit render as all-added (there is no old side to show without reading the file).
    `function pm(o,n){const out=[];for(const l of String(o).split("\\n"))out.push("-"+l);for(const l of String(n).split("\\n"))out.push("+"+l);return out}` +
    `function diffLines(name,inp){` +
    `if(name==="Edit"&&(inp.old_string!=null||inp.new_string!=null))return pm(inp.old_string||"",inp.new_string||"");` +
    `if(name==="MultiEdit"&&Array.isArray(inp.edits))return inp.edits.flatMap(e=>e?pm(e.old_string||"",e.new_string||""):[]);` +
    `if(name==="Write"&&inp.content!=null)return String(inp.content).split("\\n").map(l=>"+"+l);` +
    `if(name==="NotebookEdit"&&inp.new_source!=null)return String(inp.new_source).split("\\n").map(l=>"+"+l);` +
    `return []}` +
    `process.stdin.setEncoding("utf8");` +
    `process.stdin.on("data",d=>{buf+=d;let i;while((i=buf.indexOf("\\n"))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);handle(line)}});` +
    `process.stdin.on("end",()=>{if(buf.trim())handle(buf)});` +
    `function txt(c){return Array.isArray(c)?c.map(b=>b&&b.type==="text"?b.text:"").join(""):(typeof c==="string"?c:"")}` +
    `function clip(ls){const head=[];let bytes=0;for(const l0 of ls){if(head.length>=${RESULT_MAX_LINES})break;const l=l0.length>${RESULT_MAX_LINE_CHARS}?l0.slice(0,${RESULT_MAX_LINE_CHARS})+" …":l0;const b=Buffer.byteLength(l,"utf8")+3;if(head.length&&bytes+b>${RESULT_MAX_BYTES})break;bytes+=b;head.push(l)}` +
    `const cut=ls.length-head.length;if(cut>0)head.push("… "+cut+" more lines");return head}` +
    `function handle(line){line=line.trim();if(!line)return;let e;try{e=JSON.parse(line)}catch(_){w(df(line));return}` +
    `try{` +
    // One formatter process is one `claude` invocation, i.e. exactly one turn — so the marker is
    // written at most once. Claude Code can emit a SECOND system/init mid-stream (observed after an
    // interrupted turn resumed with -c, where a killed background task makes it re-init), which
    // rendered as two "session started" lines back to back and read like the turn had restarted and
    // lost its context. It had not: same session, same conversation.
    `if(e.type==="system"&&e.subtype==="init"){if(!inited){inited=true;w("● session started (model "+(e.model||"?")+")")}return}` +
    `if(e.type==="assistant"&&e.message){if(e.message.usage)ctx=usum(e.message.usage)+(e.message.usage.output_tokens||0);for(const b of e.message.content||[]){` +
    // Trailing "\n" => a BLANK line after each text block. Consecutive assistant text blocks are
    // separate markdown documents (a table, then a fenced block); glued with a single newline the
    // renderer reads "| 1 | 2 |```bash" as one paragraph and the fence never opens.
    `if(b.type==="text"&&b.text.trim()){const t=b.text.trim();seenText.add(t);st();w(df(t)+"\\n")}` +
    // Extended thinking arrives as its own block. It is written between sentinels so the UI can fold
    // it into a collapsed "Thought for a moment" panel instead of reading it as the agent's prose.
    `else if(b.type==="thinking"&&b.thinking&&String(b.thinking).trim()){w("${THINK_OPEN}\\n"+df(String(b.thinking).trim())+"\\n${THINK_CLOSE}")}` +
    // TodoWrite = the agent's plan. Written as a checklist block ([x] done, [>] in progress, [ ] todo)
    // so the UI renders a live plan card; the tool row itself would only say "TodoWrite".
    // The open sentinel carries the wall-clock ms of the snapshot. Consecutive snapshots bracket the
    // window a step was in progress, which is the ONLY source of a per-step duration — the log has no
    // other clock. Logs written before this stamp simply parse without a time and show no duration.
    `else if(b.type==="tool_use"&&b.name==="TodoWrite"&&Array.isArray((b.input||{}).todos)){if(b.id)planIds.add(b.id);w("${PLAN_OPEN} "+Date.now()+"\\n"+b.input.todos.map(t=>(t.status==="completed"?"[x] ":t.status==="in_progress"?"[>] ":"[ ] ")+df(String(t.content||t.activeForm||"").replace(/\\s*\\n\\s*/g," ").slice(0,160))).join("\\n")+"\\n${PLAN_CLOSE}")}` +
    // TaskCreate/TaskUpdate ARE the plan on newer Claude Code. Fold each into a plan snapshot and drop
    // the tool row: `→ TaskUpdate` carries no argument the reader can use (its input is a taskId and a
    // status), so as a row it is pure noise — the checklist ticking IS the information.
    `else if(b.type==="tool_use"&&b.name==="TaskCreate"&&b.input){if(b.id)planIds.add(b.id);const t=oneLine(b.input.subject||b.input.description);if(t){tasks.push({t:t,s:"pending"});emitPlan()}}` +
    `else if(b.type==="tool_use"&&b.name==="TaskUpdate"&&b.input){if(b.id)planIds.add(b.id);const n=parseInt(String(b.input.taskId),10);const t=tasks[n-1];` +
    `if(t){if(b.input.subject)t.t=oneLine(b.input.subject);if(b.input.status)t.s=String(b.input.status);emitPlan()}}` +
    // The headline arg is ONE log line. A multi-line command (a for-loop, a heredoc) otherwise spills
    // its 2nd..Nth lines into the log as bare text, where the parser reads the indented ones as this
    // tool's "result" and the rest as agent prose — the real output then lands in a stray say block.
    // Stamp the tool_use id (short tail) so a result can be matched to ITS OWN call. With parallel
    // tool use one assistant message issues N tool_use blocks and the N results arrive afterwards;
    // without a correlation token the parser can only attach every result to the most recent call.
    `else if(b.type==="tool_use"){const inp=b.input||{};const arg=String(inp.command||inp.skill||inp.file_path||inp.path||inp.pattern||inp.description||"").replace(/\\s*\\n\\s*/g," ").trim();st();w("→ "+b.name+(arg?": "+df(arg.slice(0,200)):"")+(b.id?" ${ID_OPEN}"+String(b.id).slice(-8)+"${ID_CLOSE}":""));` +
    // Per-edit diff block: what the Edit/Write actually changes, as -old/+new lines. Defanged and
    // capped (lines then bytes) — the truncation is announced, mirroring the tool_result budgets.
    `const dd=diffLines(b.name,inp);if(dd.length){const head=[];let bytes=0;let cut=0;for(const l of dd){if(head.length>=${DIFF_MAX_LINES}||bytes+l.length+1>${DIFF_MAX_BYTES}){cut++;continue}bytes+=l.length+1;head.push(l)}` +
    `if(cut>0)head.push("… "+cut+" more lines");w("${DIFF_OPEN}\\n"+df(head.join("\\n"))+"\\n${DIFF_CLOSE}")}}` +
    `}return}` +
    `if(e.type==="user"&&e.message){for(const b of e.message.content||[]){` +
    // Cap the result, but SAY SO. Silently dropping the tail made a truncated listing look like the
    // command's complete output — and the tail is unrecoverable, the raw stream-json is not kept.
    // Two independent budgets: lines (readability) and bytes (a few-line `cat` of a minified bundle
    // is megabytes, and .agent.log is re-read whole on every SSE poll). Whichever binds first wins.
    // A FAILED tool call is marked, so the UI can show it failed. Without this a command that errored
    // renders exactly like one that succeeded — its stderr just looks like ordinary output.
    `if(b.type==="tool_result"){if(b.tool_use_id&&planIds.has(b.tool_use_id))continue;const r=txt(b.content).trim();const id=b.tool_use_id?"${ID_OPEN}"+String(b.tool_use_id).slice(-8)+"${ID_CLOSE} ":"";if(r||id)st();if(r){w("  "+id+(b.is_error?"${ERR_MARK} ":"")+clip(df(r).split("\\n")).join("\\n  "))}else if(id)w("  "+id+(b.is_error?"${ERR_MARK} ":"")+"(no output)")}` +
    `}return}` +
    // Re-emit the run's final result ONLY when it is not simply the assistant text we already wrote.
    // Claude's `result` IS the last assistant message, so the unconditional re-emit appended the
    // whole closing summary a second time — the duplicate the reader sees at the end of every run.
    `if(e.type==="result"){const r=e.result?String(e.result).trim():"";if(r&&!seenText.has(r))w(df(r));` +
    // Turn-end usage sentinel: cumulative in/out from the result frame, context footprint from the
    // last assistant message. Written raw (not via w's redaction path it still goes through, but not
    // defanged) — this is FORMATTER structure, like ⟦plan⟧, so it must parse at column 0.
    `if(e.usage){w("${USAGE_OPEN} in="+usum(e.usage)+" out="+(e.usage.output_tokens||0)+" ctx="+ctx)}return}` +
    `}catch(_){}}`;
  // base64 the whole script and decode in the box: shipping a large JS blob through
  // shell/SSH/msb-exec quoting was corrupting it (trailing garbage → SyntaxError at load).
  // base64 has no shell-special chars, so the file lands byte-for-byte intact.
  const b64 = Buffer.from(js, "utf8").toString("base64");
  return (
    `mkdir -p "$HOME/.claude" && ` +
    `printf '%s' '${b64}' | base64 -d > "$HOME/.claude/stream-fmt.js"`
  );
}

// Agent invocation reads the task from $AGENT_TASK (set via -e), so the task text is data.
// Claude Code refuses --dangerously-skip-permissions as root (boxes run as root), so we grant
// the concrete tools the agent needs instead. Bash covers git/gh/npm; this is safe because the
// box is an isolated microVM with a curated egress allowlist. --allowedTools takes multiple
// space-separated values, so it goes LAST in the command.
// Skill lets claude load dashboard-configured skills (installed under /root/.claude/skills).
const ALLOWED_TOOLS = "Bash Edit Write Read Glob Grep TodoWrite TaskCreate TaskUpdate TaskList WebFetch WebSearch Skill";

/** Shell for one Claude Code turn: `claude [-c] -p`, piped through stream-fmt.js into the log. */
export function claudeLaunchSh(resume: boolean): string {
  // --setting-sources user: load ONLY user settings, so a cloned repo's own .claude/settings.json
  // (and its hooks) is never loaded. Target repos commonly ship a UserPromptSubmit "plugin gate"
  // hook that hard-blocks every prompt when marketplace plugins aren't installed — which they aren't
  // in a headless box — making Claude exit 0 doing nothing. Skipping project settings avoids that;
  // we grant tools ourselves via --allowedTools, so we don't need the repo's permissions.allow.
  const settingSources = `--setting-sources user`;
  // stream-json (+ required --verbose) emits one JSON event per line as work happens; we pipe it
  // through the formatter so the dashboard terminal streams live instead of dumping at the end.
  // --include-partial-messages additionally emits `stream_event` frames carrying content_block_delta
  // token deltas. Without it Claude only emits a text block once the whole paragraph is composed, so
  // the dashboard paints prose in one jump and then sits frozen — measured 12s dead windows against
  // an 800ms SSE tick. With deltas the formatter appends text as it is generated and prose types out.
  const streamFmt = `--output-format stream-json --verbose --include-partial-messages`;
  const cont = resume ? `-c ` : ``;
  // MCP servers configured on the dashboard land in /root/.agent-mcp.json before the run (see
  // installMcpConfig); when the file has content, claude loads them. Their tools are allowed via the
  // mcp__<server>__* wildcard so the agent can actually call them.
  const mcpFlag = `$([ -s ${MCP_CONFIG_PATH} ] && printf -- '--mcp-config ${MCP_CONFIG_PATH}')`;
  const claude =
    `claude ${cont}-p "$AGENT_TASK" ${settingSources} ${streamFmt} ${mcpFlag} ` +
    `--append-system-prompt "$AGENT_SYS_PROMPT" --allowedTools ${ALLOWED_TOOLS} ` +
    `$([ -s ${MCP_CONFIG_PATH} ] && printf -- '%s' "$(node -e 'const c=require(\"${MCP_CONFIG_PATH}\");process.stdout.write(Object.keys(c.mcpServers||{}).map(n=>\"mcp__\"+n).join(\" \"))')")`;
  return `${claude} 2>> ${AGENT_LOG} | node "$HOME/.claude/stream-fmt.js" ${AGENT_LOG}; `;
}

export const claudeDriver: Driver = {
  kind: "claude",
  label: "Claude Code",
  capabilities: {
    // PreToolUse hook returning permissionDecision:"deny" (askHookScript) — the reference gate.
    gate: "hook",
    sideQuestion: true,
    planEvents: true,
    resume: true,
    modelSources: ["anthropic"],
  },
  install: (cfg) => claudeInstallSh(cfg.claudeCodeVersion),
  launch: ({ resume }) => claudeLaunchSh(resume),
  gateScript: () => askHookScript(),
  formatter: () => streamFmtScript(),
  systemPrompt: AGENT_SYS_PROMPT,
  envFlags: () => [],
};
