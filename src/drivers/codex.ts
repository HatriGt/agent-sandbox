/**
 * The OpenAI Codex CLI driver.
 *
 * Sources (developers.openai.com/codex, read 2026-09-30):
 *  - non-interactive mode: `codex exec --json` streams JSONL (thread.started, turn.started,
 *    turn.completed{usage}, turn.failed, item.started/updated/completed, error). Item types:
 *    agent_message, reasoning, command_execution, file_change, mcp_tool_call, web_search, todo_list.
 *    `codex exec resume --last "<prompt>"` continues the session. Exec never prompts for approval.
 *  - hooks: a PreToolUse command hook gets the call as JSON on stdin and DENIES it by printing
 *    {hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",…}} — the same
 *    contract as Claude Code, so the gate reuses the ask-gate/guard scripts Claude's bootstrap
 *    already installs under ~/.claude/hooks. Hooks need trust; `--dangerously-bypass-hook-trust`
 *    is the documented switch for automation that vets its hooks itself (we write them).
 *    Documented limits, surfaced in the caveat: hosted tools (web search) never reach the hook, and
 *    a hook that errors or times out fails OPEN.
 */
import { AGENT_LOG } from "./sentinels.js";
import { AGENT_SYS_PROMPT } from "./prompts.js";
import { fmtLoop, fmtPrelude, installJs } from "./fmt-common.js";
import type { Driver } from "./types.js";

const CODEX_FMT = `$HOME/.codex/codex-fmt.js`;

export function codexInstallSh(): string {
  return `command -v codex >/dev/null 2>&1 || npm i -g @openai/codex`;
}

/** ~/.codex/hooks.json: every local tool call passes the ask gate and the guard first. */
export function codexGateScript(): string {
  const hooks = {
    description: "agent-sandbox: pending-question gate + control-plane guard",
    hooks: {
      PreToolUse: [
        {
          matcher: ".*",
          hooks: [
            { type: "command", command: "$HOME/.claude/hooks/ask-gate.sh", timeout: 30 },
            { type: "command", command: "$HOME/.claude/hooks/guard.sh", timeout: 30 },
          ],
        },
      ],
    },
  };
  const b64 = Buffer.from(JSON.stringify(hooks, null, 2), "utf8").toString("base64");
  return `mkdir -p "$HOME/.codex" && printf '%s' '${b64}' | base64 -d > "$HOME/.codex/hooks.json"`;
}

/** codex exec JSONL → the shared sentinel grammar. */
export function codexFmtProgram(): string {
  return (
    fmtPrelude() +
    `const seen=new Set();` +
    `function arg(it){if(it.type==="command_execution")return it.command;if(it.type==="web_search")return it.query;` +
    `if(it.type==="mcp_tool_call")return typeof it.arguments==="string"?it.arguments:JSON.stringify(it.arguments||"");` +
    `if(it.type==="file_change")return (it.changes||[]).map(c=>c.path).join(", ");return ""}` +
    `function tname(it){if(it.type==="command_execution")return "Bash";if(it.type==="file_change")return "Edit";if(it.type==="web_search")return "WebSearch";` +
    `if(it.type==="mcp_tool_call")return "mcp__"+(it.server||"?")+"__"+(it.tool||"?");return ""}` +
    `function row(it){if(seen.has(it.id))return;seen.add(it.id);toolRow(tname(it),arg(it),it.id)}` +
    `function handle(e){const t=e.type;` +
    `if(t==="thread.started"||t==="turn.started"){session(process.env.AGENT_MODEL||process.env.OPENAI_MODEL||"codex");return}` +
    `if(t==="turn.completed"){const u=e.usage||{};const inn=(u.input_tokens||0);const o=(u.output_tokens||0)+(u.reasoning_output_tokens||0);usage(inn,o,inn+o);return}` +
    `if(t==="turn.failed"){errLine((e.error&&e.error.message)||"turn failed");return}` +
    `if(t==="error"){errLine(e.message||"error");return}` +
    `if(!/^item\\./.test(t)||!e.item)return;const it=e.item;session(process.env.AGENT_MODEL||process.env.OPENAI_MODEL||"codex");` +
    `if(it.type==="todo_list"){plan((it.items||[]).map(x=>({t:x.text,s:x.completed?"done":"todo"})));return}` +
    `if(t!=="item.completed"){if(tname(it)&&t==="item.started")row(it);return}` +
    `if(it.type==="agent_message"){say(it.text);return}` +
    `if(it.type==="reasoning"){think(it.text);return}` +
    `if(it.type==="command_execution"){row(it);result(it.id,it.aggregated_output,it.status==="failed"||(it.exit_code!=null&&it.exit_code!==0));return}` +
    `if(it.type==="file_change"){row(it);result(it.id,(it.changes||[]).map(c=>(c.kind||"update")+" "+c.path).join("\\n"),it.status==="failed");return}` +
    `if(it.type==="mcp_tool_call"){row(it);const r=it.result&&Array.isArray(it.result.content)?it.result.content.map(c=>c&&c.text||"").join(""):(it.error&&it.error.message)||"";result(it.id,r,it.status==="failed"||!!it.error);return}` +
    `if(it.type==="web_search"){row(it);result(it.id,"",false);return}` +
    `if(it.type==="error"){errLine(it.message);return}` +
    `}` +
    fmtLoop()
  );
}

export function codexFmtScript(): string {
  return installJs("$HOME/.codex", "codex-fmt.js", codexFmtProgram());
}

/**
 * One Codex turn. Codex has no --append-system-prompt; the standing policy rides at the head of the
 * first turn's prompt (the session keeps it for resumes). The box is the isolation boundary, so the
 * inner sandbox is off (danger-full-access) — Codex's landlock sandbox is not guaranteed in a microVM.
 */
export function codexLaunchSh(resume: boolean): string {
  const common =
    `--json --skip-git-repo-check --dangerously-bypass-hook-trust --sandbox danger-full-access ` +
    `$([ -n "$AGENT_MODEL" ] && printf -- '-m %s' "$AGENT_MODEL")`;
  const cmd = resume
    ? `codex exec resume --last ${common} "$AGENT_TASK"`
    : `codex exec ${common} "$(printf '%s\\n\\n%s' "$AGENT_SYS_PROMPT" "$AGENT_TASK")"`;
  return `${cmd} 2>> ${AGENT_LOG} | node "${CODEX_FMT}" ${AGENT_LOG}; `;
}

export const codexDriver: Driver = {
  kind: "codex",
  label: "Codex CLI",
  capabilities: {
    gate: "hook",
    gateVerifiedLive: false,
    sideQuestion: true,
    planEvents: true,
    resume: true,
    modelSources: ["openai", "openai-compatible"],
    caveat:
      "Gate follows Codex's documented PreToolUse deny contract; hosted web search bypasses it and a failing hook fails open.",
  },
  install: () => codexInstallSh(),
  launch: ({ resume }) => codexLaunchSh(resume),
  gateScript: () => codexGateScript(),
  formatter: () => codexFmtScript(),
  systemPrompt: AGENT_SYS_PROMPT,
  envFlags: () => [],
};
