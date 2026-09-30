/**
 * The oh-my-pi driver, moved verbatim out of src/msb.ts onto the Driver contract. Rides the same
 * ccproxy env as Claude Code; its gate is the asb-guard `tool_call` extension.
 */
import { redactShapesSource } from "../redact.js";
import {
  AGENT_LOG,
  AT_MARK,
  ERR_MARK,
  ID_CLOSE,
  ID_OPEN,
  QUESTION_MARK,
  RESULT_MAX_BYTES,
  RESULT_MAX_LINES,
  RESULT_MAX_LINE_CHARS,
  THINK_CLOSE,
  THINK_OPEN,
  USAGE_OPEN,
} from "./sentinels.js";
import { OMP_SYS_PROMPT } from "./prompts.js";
import type { Driver } from "./types.js";

/**
 * Version-aware oh-my-pi install. omp's runtime is bun, and BOTH ride in from the npm registry —
 * deliberately: registry.npmjs.org is already on the default egress allowlist, so an omp run works
 * in a restricted-egress box without widening the allowlist. "latest" is presence-checked only; a
 * pinned semver is checked against `omp --version` (same upgrade semantics as claudeInstallSh).
 * OMP_SKIP_SETUP=1 keeps the version probe and first run from opening the interactive setup.
 */
export function ompInstallSh(version: string): string {
  if (version !== "latest" && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    throw new Error(`invalid oh-my-pi version: ${JSON.stringify(version)}`);
  }
  // --allow-scripts=bun: npm ≥11.5 blocks install scripts by default, and bun's postinstall IS the
  // download of the actual binary — without it the global `bun` is a dead stub (measured live).
  // Older npms warn about the unknown flag and proceed. BUN_INSTALL=/usr/local puts bun's global
  // bin dir on the default PATH (its ~/.bun/bin default is invisible to the run's `sh -lc`).
  const bun = `command -v bun >/dev/null 2>&1 || npm i -g bun --allow-scripts=bun >/dev/null 2>&1 || true`;
  const install = (spec: string) =>
    `OMP_SKIP_SETUP=1 BUN_INSTALL=/usr/local bun i -g ${spec} >/dev/null 2>&1 || npm i -g ${spec}`;
  if (version === "latest") {
    return `${bun}; command -v omp >/dev/null 2>&1 || { ${install("@oh-my-pi/pi-coding-agent")}; }`;
  }
  return (
    `${bun}; [ "$(OMP_SKIP_SETUP=1 omp --version 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -n1)" = "${version}" ] || ` +
    `{ ${install(`@oh-my-pi/pi-coding-agent@${version}`)}; }`
  );
}

/**
 * Install the oh-my-pi event → human-log formatter at ~/.claude/omp-fmt.js.
 *
 * Contract: it writes the SAME log grammar as stream-fmt.js (● session marker, `→ Tool: arg` rows
 * with ⟦#id⟧ correlation, indented clipped results, ⟦think⟧/⟦usage⟧/⟦err⟧ sentinels), so trace.ts
 * and the dashboard transcript are agent-agnostic. Input handling is deliberately defensive: omp's
 * exact event vocabulary is not ours to pin, so a JSON line with an unknown `type` is DROPPED
 * (raw JSON would corrupt the transcript) while a non-JSON line passes through defanged — plain
 * `omp -p` prose still streams even if the event shapes drift.
 */
export function ompFmtScript(): string {
  const js =
    `const fs=require("fs");` +
    `const out=process.argv[2];` +
    `${redactShapesSource()}\n` +
    `function w(s){try{fs.appendFileSync(out,redactShapes(String(s))+"\\n")}catch(e){}}` +
    `function df(s){return String(s).replace(/\\u27e6/g,"\\u200b\\u27e6").replace(/^\\u25cf/gm,"\\u200b\\u25cf").replace(/^\\u2192/gm,"\\u200b\\u2192")}` +
    `let inited=false;` +
    `function st(){w("${AT_MARK} "+Date.now())}` +
    `function oneLine(v){return df(String(v==null?"":v).replace(/\\s*\\n\\s*/g," ").trim().slice(0,200))}` +
    `function idTok(id){return id?" ${ID_OPEN}"+String(id).slice(-8)+"${ID_CLOSE}":""}` +
    `function txt(c){if(Array.isArray(c))return c.map(b=>b&&(b.type==="text"||b.type==="toolResult")?String(b.text||b.output||""):"").join("");return typeof c==="string"?c:""}` +
    `function clip(ls){const head=[];let bytes=0;for(const l0 of ls){if(head.length>=${RESULT_MAX_LINES})break;const l=l0.length>${RESULT_MAX_LINE_CHARS}?l0.slice(0,${RESULT_MAX_LINE_CHARS})+" …":l0;const b=Buffer.byteLength(l,"utf8")+3;if(head.length&&bytes+b>${RESULT_MAX_BYTES})break;bytes+=b;head.push(l)}` +
    `const cut=ls.length-head.length;if(cut>0)head.push("… "+cut+" more lines");return head}` +
    `function toolArg(a){a=a||{};return String(a.command||a.cmd||a.path||a.file_path||a.filePath||a.pattern||a.query||a.url||a.description||"")}` +
    `function toolRow(b){const arg=oneLine(toolArg(b.arguments||b.args||b.input));st();w("→ "+String(b.name||b.toolName||"tool")+(arg?": "+arg:"")+idTok(b.id||b.toolCallId))}` +
    `function result(id,body,isErr){const r=String(body==null?"":body).trim();const tok=id?"${ID_OPEN}"+String(id).slice(-8)+"${ID_CLOSE} ":"";if(r||tok)st();` +
    `if(r)w("  "+tok+(isErr?"${ERR_MARK} ":"")+clip(df(r).split("\\n")).join("\\n  "));else if(tok)w("  "+tok+(isErr?"${ERR_MARK} ":"")+"(no output)")}` +
    `function usage(u){if(!u)return;const inn=(u.input||u.input_tokens||0)+(u.cacheRead||u.cache_read_input_tokens||0)+(u.cacheWrite||u.cache_creation_input_tokens||0);` +
    `const o=(u.output||u.output_tokens||0);w("${USAGE_OPEN} in="+inn+" out="+o+" ctx="+(inn+o))}` +
    `function onMessage(m){if(!m||typeof m!=="object")return;const role=String(m.role||"");` +
    // The session marker: omp's own "session" event carries no model, so the marker is emitted on
    // the FIRST assistant message, whose .model is what actually answered (measured live).
    `if(role==="assistant"&&!inited){inited=true;w("● session started (model "+String(m.model||"?")+")")}` +
    `if(role==="assistant"){for(const b of Array.isArray(m.content)?m.content:[]){if(!b)continue;` +
    `if(b.type==="text"&&String(b.text||"").trim()){st();w(df(String(b.text).trim())+"\\n")}` +
    `else if(b.type==="thinking"&&String(b.thinking||b.text||"").trim())w("${THINK_OPEN}\\n"+df(String(b.thinking||b.text).trim())+"\\n${THINK_CLOSE}");` +
    `else if(b.type==="toolCall"||b.type==="tool_call"||b.type==="tool_use")toolRow(b)}` +
    `if(typeof m.content==="string"&&m.content.trim()){st();w(df(m.content.trim())+"\\n")}` +
    `return}` +
    `if(role==="toolResult"||role==="tool"||role==="tool_result"){const id=m.toolCallId||m.tool_call_id||m.toolUseId||m.id;` +
    `result(id,txt(m.content)||m.output||m.result||m.text,!!(m.isError||m.is_error));return}}` +
    `let buf="";` +
    `process.stdin.setEncoding("utf8");` +
    `process.stdin.on("data",d=>{buf+=d;let i;while((i=buf.indexOf("\\n"))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);handle(line)}});` +
    `process.stdin.on("end",()=>{if(buf.trim())handle(buf)});` +
    `function handle(line){line=line.replace(/\\r$/,"");if(!line.trim())return;let e=null;` +
    `if(/^[\\[{]/.test(line.trim())){try{e=JSON.parse(line)}catch(_){e=null}}` +
    `if(!e||typeof e!=="object"||Array.isArray(e)||!e.type){w(df(line));return}` +
    `try{const t=String(e.type);` +
    // The marker goes out at agent_start (turn one begins) rather than waiting for the first
    // assistant message: the dashboard shows "Starting up" until this line lands, and on a real
    // task the model's time-to-first-message added seconds of it after omp was already working.
    // The model is the requested alias (what claude's init frame reports too); onMessage's
    // first-assistant path stays as the fallback for an omp that stops emitting agent_start.
    `if(t==="agent_start"){if(!inited){inited=true;w("● session started (model "+String(process.env.ANTHROPIC_MODEL||"?")+")")}return}` +
    `if(t==="message_end"||t==="message"){onMessage(e.message||e);return}` +
    // Turn-end carries the turn's final assistant message with cumulative usage — ONE usage line
    // per turn, like the Claude formatter's result frame. (tool results are NOT read from
    // tool_execution_end: the same result arrives again as a role:"toolResult" message_end, and
    // handling both wrote every output twice — measured live.)
    `if(t==="turn_end"){usage(e.message&&e.message.usage);return}` +
    `if(t==="error"&&(e.message||e.error))w("${ERR_MARK} "+oneLine(String(e.message||e.error)));` +
    `}catch(_){}}`;
  const b64 = Buffer.from(js, "utf8").toString("base64");
  return (
    `mkdir -p "$HOME/.claude" && ` +
    `printf '%s' '${b64}' | base64 -d > "$HOME/.claude/omp-fmt.js"`
  );
}

/**
 * Install the asb-guard omp extension: question-pause parity with the Claude ask-gate plus the
 * control-plane file guard, as an in-process `tool_call` pre-event (omp has no PreToolUse hooks).
 * Once ${QUESTION_MARK} exists every further tool call is BLOCKED, so writing a question truly
 * ends the turn — same enforcement the Claude branch gets from ask-gate.sh. It also blocks any
 * tool call whose params reference the controller's .agent.* files (except the question write
 * itself) — a live omp run was observed reading .agent.question out of curiosity.
 * Plain JS (not TS) so the payload is vm-parseable in tests and independent of loader behavior.
 */
export function ompGuardScript(): string {
  // Contract verified against omp 18.4.3's shipped types + live: the handler receives
  // { toolName, toolCallId, input } and BLOCKS by returning { block: true, reason } — the reason is
  // surfaced to the model as the tool error. (The docs' `return false` form is a silent no-op.)
  // A single .js file in ~/.omp/agent/extensions/ is auto-scanned in headless -p runs.
  const indexJs =
    `import fs from "node:fs";\n` +
    `const Q = ${JSON.stringify(QUESTION_MARK)};\n` +
    `const AGENT_FILES = /\\/workspace\\/\\.agent\\./;\n` +
    `export default function asbGuard(pi) {\n` +
    `  pi.on("tool_call", (ev) => {\n` +
    `    const name = String((ev && ev.toolName) || "");\n` +
    `    let blob = "";\n` +
    `    try { blob = JSON.stringify((ev && ev.input) || {}); } catch (_) {}\n` +
    `    const isQuestionWrite = /write/i.test(name) && blob.includes(Q);\n` +
    // A pending question means the turn is OVER: deny everything until the caller answers.
    `    try { if (fs.existsSync(Q)) return { block: true, reason: "A question is pending in " + Q + " and is awaiting the caller. Do NOT take any further action or guess an answer — end your turn now. The session will be resumed with the answer." }; } catch (_) {}\n` +
    // The controller's channel files are not context; only the question write may touch them.
    `    if (AGENT_FILES.test(blob) && !isQuestionWrite) return { block: true, reason: "/workspace/.agent.* files are the controller's channel, not context — never read, print, or modify them." };\n` +
    `  });\n` +
    `}\n`;
  const idxB64 = Buffer.from(indexJs, "utf8").toString("base64");
  return (
    `mkdir -p "$HOME/.omp/agent/extensions" && rm -rf "$HOME/.omp/agent/extensions/asb-guard" && ` +
    `printf '%s' '${idxB64}' | base64 -d > "$HOME/.omp/agent/extensions/asb-guard.js"`
  );
}

/** Shell that (re)writes ~/.omp/agent/models.yml from the ANTHROPIC_* env — the ccproxy provider. */
export function ompSeedSh(): string {
  return (
    `node -e 'const fs=require("fs"),os=require("os"),p=require("path");` +
    `const d=p.join(os.homedir(),".omp","agent");fs.mkdirSync(d,{recursive:true});` +
    `const q=JSON.stringify,id=process.env.ANTHROPIC_MODEL||"";` +
    `const smol=process.env.ANTHROPIC_SMOL_MODEL||"";` +
    `const ids=smol&&smol!==id?[id,smol]:[id];` +
    `const y="providers:\\n  ccproxy:\\n    baseUrl: "+q(process.env.ANTHROPIC_BASE_URL||"")+"\\n    api: anthropic-messages\\n    apiKey: "+q(process.env.ANTHROPIC_API_KEY||"")+"\\n    models:\\n"+ids.map(m=>"      - id: "+q(m)+"\\n        name: "+q(m)+"\\n        contextWindow: 200000\\n        maxTokens: 32000\\n").join("");` +
    `fs.writeFileSync(p.join(d,"models.yml"),y)'`
  );
}

/** Shell for one oh-my-pi turn, piped through omp-fmt.js into the log. */
export function ompLaunchSh(resume: boolean): string {
  // Model access rides through the SAME ccproxy env the claude driver gets: a `ccproxy` provider
  // (Anthropic Messages API) is (re)written into ~/.omp/agent/models.yml from the env at launch, so
  // `--model ccproxy/$ANTHROPIC_MODEL` selects the controller-validated alias. omp has no
  // --append-system-prompt, so the standing policy is prefixed to the FIRST prompt only (resumes
  // continue the same omp session, which already carries it).
  const ompSeed = ompSeedSh();
  const ompPrompt = resume ? `"$AGENT_TASK"` : `"$AGENT_SYS_PROMPT"$'\\n\\n'"$AGENT_TASK"`;
  // --mode json: one NDJSON event per line for the formatter (plain -p buffers prose and shows no
  // tool activity). --approval-mode=yolo: headless runs have no one to click "approve" — the box's
  // isolation (microVM + egress allowlist) is the permission boundary, same stance as the claude
  // driver's --allowedTools grant.
  const omp =
    `${ompSeed} && OMP_SKIP_SETUP=1 omp ${resume ? `--continue ` : ``}--mode json --approval-mode=yolo ` +
    `--model "ccproxy/$ANTHROPIC_MODEL"` +
    `$([ -n "$ANTHROPIC_SMOL_MODEL" ] && printf -- ' --smol ccproxy/%s' "$ANTHROPIC_SMOL_MODEL") -p ${ompPrompt}`;
  // omp prints one "Warning: MCP server X failed to connect" per unreachable server to stderr at
  // EVERY session start (Claude Code fails the same connections silently), so the transcript led
  // with a wall of warnings on every task. They are per-run noise — the MCP settings page's Test
  // button is the diagnosis surface — so stderr is filtered before it reaches the log. Everything
  // else on stderr (real errors) still lands.
  const ompStderr = `2> >(grep -vE '^Warning: MCP server ' >> ${AGENT_LOG})`;
  return `${omp} ${ompStderr} | node "$HOME/.claude/omp-fmt.js" ${AGENT_LOG}; `;
}

export const ompDriver: Driver = {
  kind: "omp",
  label: "oh-my-pi",
  capabilities: {
    // The asb-guard extension blocks tool calls in-process via omp's `tool_call` pre-event
    // (verified against omp 18.4.3's shipped types and live) — a real deny, not a kill.
    gate: "hook",
    sideQuestion: true,
    // omp has no TodoWrite equivalent the formatter maps to ⟦plan⟧ yet.
    planEvents: false,
    resume: true,
    modelSources: ["anthropic"],
    caveat: "No plan card: oh-my-pi has no structured plan events the thread can render.",
  },
  install: (cfg) => ompInstallSh(cfg.ompVersion),
  launch: ({ resume }) => ompLaunchSh(resume),
  gateScript: () => ompGuardScript(),
  formatter: () => ompFmtScript(),
  systemPrompt: OMP_SYS_PROMPT,
  // omp model roles: lightweight subtasks (summaries, quick lookups) run on the cheap "smol" alias
  // instead of the driver model — the ask-lane alias is exactly that tier. The seed script writes
  // this id into models.yml too, and the launch passes `--smol ccproxy/<id>` when the env is present.
  envFlags: (cfg) => (cfg.askModel ? ["-e", `ANTHROPIC_SMOL_MODEL=${cfg.askModel}`] : []),
};
