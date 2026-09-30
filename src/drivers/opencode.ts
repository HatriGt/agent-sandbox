/**
 * The OpenCode driver.
 *
 * Sources (opencode.ai/docs, read 2026-09-30):
 *  - CLI: `opencode run --format json` emits raw JSON events; `-c` continues the last session,
 *    `-m provider/model` picks the model, `--auto` approves permissions not explicitly denied.
 *  - plugins: a global plugin's `tool.execute.before(input, output)` hook runs before every tool
 *    call and BLOCKS it by throwing (the documented .env-protection example). That is our gate:
 *    ~/.config/opencode/plugins/asb-gate.js throws while a question is pending, and asks the shared
 *    guard (src/guard.ts, installed by Claude's bootstrap at ~/.claude/hooks/guard.js) about the call.
 *
 * What is NOT documented is the JSON event schema of `run --format json`, so the formatter below is
 * defensive (unknown types dropped, plain text passed through) and the plan card is not claimed.
 */
import { AGENT_LOG, QUESTION_MARK } from "./sentinels.js";
import { AGENT_SYS_PROMPT } from "./prompts.js";
import { fmtLoop, fmtPrelude, installJs } from "./fmt-common.js";
import type { Driver } from "./types.js";

const OC_FMT = `$HOME/.config/opencode/oc-fmt.js`;

export function opencodeInstallSh(): string {
  return `command -v opencode >/dev/null 2>&1 || npm i -g opencode-ai`;
}

/** The gate plugin, as a program (exported for the tests, which load it and call the hook). */
export function opencodeGatePlugin(): string {
  return (
    `import fs from "node:fs";import os from "node:os";import path from "node:path";import cp from "node:child_process";\n` +
    `const Q=${JSON.stringify(QUESTION_MARK)};\n` +
    `const NAMES={bash:"Bash",edit:"Edit",write:"Write",read:"Read",glob:"Glob",grep:"Grep",webfetch:"WebFetch"};\n` +
    `function guard(tool,args){const g=path.join(os.homedir(),".claude","hooks","guard.js");if(!fs.existsSync(g))return null;\n` +
    `  const a=args||{};const input={hook_event_name:"PreToolUse",tool_name:NAMES[tool]||tool,tool_input:Object.assign({},a,a.filePath?{file_path:a.filePath}:{})};\n` +
    `  const r=cp.spawnSync("node",[g],{input:JSON.stringify(input),encoding:"utf8",timeout:30000});\n` +
    `  if(r.status===2)return String(r.stderr||"blocked by guard").trim();\n` +
    `  try{const o=JSON.parse(r.stdout||"{}");const h=o.hookSpecificOutput||{};if(h.permissionDecision==="deny")return h.permissionDecisionReason||"blocked by guard"}catch(_){}\n` +
    `  return null}\n` +
    `export const AsbGate=async()=>({"tool.execute.before":async(input,output)=>{\n` +
    `  if(fs.existsSync(Q))throw new Error("A question is pending in "+Q+" and is awaiting the caller. Do NOT take any further action or guess an answer - end your turn now. It will be resumed with the answer.");\n` +
    `  const why=guard(input&&input.tool,output&&output.args);if(why)throw new Error(why)}});\n`
  );
}

export function opencodeGateScript(): string {
  return installJs("$HOME/.config/opencode/plugins", "asb-gate.js", opencodeGatePlugin());
}

export function opencodeFmtProgram(): string {
  return (
    fmtPrelude() +
    `const done=new Set();let ctx=0,tin=0,tout=0;` +
    `function targ(i){i=i||{};return i.command||i.filePath||i.path||i.pattern||i.url||i.query||i.description||""}` +
    `function handle(e){const t=e.type,p=e.part||{};` +
    `session(process.env.AGENT_MODEL||"opencode");` +
    `if(t==="text"){say(p.text);return}` +
    `if(t==="reasoning"){think(p.text);return}` +
    `if(t==="tool_use"||t==="tool"){const s=p.state||{};const id=p.callID||p.id;if(!id||done.has(id))return;` +
    `if(s.status!=="completed"&&s.status!=="error")return;done.add(id);` +
    `if(p.tool==="todowrite"&&Array.isArray((s.input||{}).todos)){plan(s.input.todos.map(x=>({t:x.content,s:x.status==="completed"?"done":x.status==="in_progress"?"doing":"todo"})));return}` +
    `toolRow(p.tool,targ(s.input),id);result(id,s.status==="error"?(s.error||"error"):s.output,s.status==="error");return}` +
    `if(t==="step_finish"){const k=p.tokens||{};const c=k.cache||{};const inn=(k.input||0)+(c.read||0)+(c.write||0);const o=(k.output||0)+(k.reasoning||0);tin+=inn;tout+=o;ctx=inn+o;return}` +
    `if(t==="error"){const er=e.error||{};errLine((er.data&&er.data.message)||er.message||er.name||"error");return}` +
    `}` +
    // Usage is summed over steps and written once at the end of the turn, like the other formatters.
    `process.stdin.on("end",()=>{if(tin||tout)usage(tin,tout,ctx)});` +
    fmtLoop()
  );
}

export function opencodeFmtScript(): string {
  return installJs("$HOME/.config/opencode", "oc-fmt.js", opencodeFmtProgram());
}

export function opencodeLaunchSh(resume: boolean): string {
  const model = `$([ -n "$AGENT_MODEL" ] && printf -- '-m %s' "$AGENT_MODEL")`;
  const cmd = resume
    ? `opencode run --format json --auto -c ${model} "$AGENT_TASK"`
    : `opencode run --format json --auto ${model} "$(printf '%s\\n\\n%s' "$AGENT_SYS_PROMPT" "$AGENT_TASK")"`;
  return `${cmd} 2>> ${AGENT_LOG} | node "${OC_FMT}" ${AGENT_LOG}; `;
}

export const opencodeDriver: Driver = {
  kind: "opencode",
  label: "OpenCode",
  capabilities: {
    gate: "hook",
    sideQuestion: true,
    planEvents: false,
    resume: true,
    modelSources: ["anthropic", "openai", "openai-compatible", "local"],
    caveat: "Gate is a documented tool.execute.before plugin; the JSON event stream is undocumented, so the transcript is best-effort and there is no plan card.",
  },
  install: () => opencodeInstallSh(),
  launch: ({ resume }) => opencodeLaunchSh(resume),
  gateScript: () => opencodeGateScript(),
  formatter: () => opencodeFmtScript(),
  systemPrompt: AGENT_SYS_PROMPT,
  envFlags: () => [],
};
