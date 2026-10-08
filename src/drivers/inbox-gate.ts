/**
 * Mid-turn delivery of operator messages — the "interject" half of the conversational agent.
 *
 * A CLI turn is one process with its prompt in argv and stdin on /dev/null, so there is no channel
 * into it. There IS a seam the turn passes through dozens of times: the PreToolUse gate (the same
 * hook that halts a turn on a pending question). So the controller mirrors a queued message into
 * the box as one JSON line in INBOX_MARK, and the next tool call the gate sees becomes the delivery:
 * the gate stamps the message into the transcript as a `⟦you⟧` bubble (where it belongs, between
 * the steps that preceded and follow it), records the id in INBOX_DELIVERED so the controller never
 * re-sends it at turn end, and DENIES that one tool call with a reason that quotes the message. The
 * model reads deny reasons, so it answers the operator inside the same turn and carries on (or
 * changes course), and the thread shows the exchange in order. No turn is killed.
 *
 * The same function source is embedded in the Claude hook (node script), the omp extension and
 * the opencode plugin, so every driver delivers the same way.
 */
import { AGENT_LOG, AT_MARK, YOU_MARK_CLOSE, YOU_MARK_OPEN } from "./sentinels.js";

export const INBOX_MARK = "/workspace/.agent.inbox";
export const INBOX_DELIVERED = "/workspace/.agent.inbox.delivered";

export interface InboxLine {
  id: string;
  text: string;
  at: number;
}

/** The deny reason the model reads. One message or several, in order. */
export function inboxReason(texts: string[]): string {
  const quoted = texts.map((t) => `"${t.trim()}"`).join("\n\n");
  return (
    `The operator just said:\n\n${quoted}\n\n` +
    `Reply to them first (a sentence or two, in your normal prose), then continue — change course if they asked you to. ` +
    `This tool call was only held for the message; run it again if you still need it.`
  );
}

/**
 * JS source of `asbInbox(fs)`: consume INBOX_MARK, stamp the transcript, record delivery, and
 * return the deny reason — or null when there is no mail. Plain ES5-ish so it runs unchanged as a
 * CommonJS hook, an ESM extension, or inside a plugin. Robust to a half-written file (the
 * controller appends whole lines; a torn last line is left for the next call).
 */
export function inboxDeliverFn(): string {
  // Sentinels are defanged in the stamped text exactly as agentSh's DEFANG_SENTINELS_SED does, so
  // a message that quotes a marker cannot forge a trace line.
  return (
    `function asbInbox(fs){\n` +
    `  var I=${JSON.stringify(INBOX_MARK)},D=${JSON.stringify(INBOX_DELIVERED)},L=${JSON.stringify(AGENT_LOG)};\n` +
    `  var raw="";try{raw=fs.readFileSync(I,"utf8")}catch(e){return null}\n` +
    `  var lines=raw.split("\\n"),msgs=[],keep=[];\n` +
    `  for(var i=0;i<lines.length;i++){var s=lines[i];if(!s.trim())continue;try{var m=JSON.parse(s);if(m&&m.id&&typeof m.text==="string")msgs.push(m);else keep.push(s)}catch(e){keep.push(s)}}\n` +
    `  if(!msgs.length)return null;\n` +
    `  try{if(keep.length)fs.writeFileSync(I,keep.join("\\n")+"\\n");else fs.unlinkSync(I)}catch(e){}\n` +
    `  var defang=function(t){return String(t).replace(/\\u27E6/g,"\\u200B\\u27E6").replace(/^\\u25CF/mg,"\\u200B\\u25CF").replace(/^\\u2192/mg,"\\u200B\\u2192")};\n` +
    `  var out="";for(var j=0;j<msgs.length;j++){out+=${JSON.stringify(AT_MARK)}+" "+(msgs[j].at||Date.now())+"\\n"+${JSON.stringify(YOU_MARK_OPEN)}+"\\n"+defang(msgs[j].text)+"\\n"+${JSON.stringify(YOU_MARK_CLOSE)}+"\\n"}\n` +
    `  try{fs.appendFileSync(L,out)}catch(e){}\n` +
    `  try{fs.appendFileSync(D,msgs.map(function(m){return m.id}).join("\\n")+"\\n")}catch(e){}\n` +
    `  var texts=msgs.map(function(m){return m.text});\n` +
    `  return ${inboxReasonJs()};\n` +
    `}\n`
  );
}

/** `inboxReason` as an inline JS expression over `texts`, kept in lock-step with the TS version. */
function inboxReasonJs(): string {
  return (
    `"The operator just said:\\n\\n"+texts.map(function(t){return '"'+String(t).trim()+'"'}).join("\\n\\n")+` +
    `"\\n\\nReply to them first (a sentence or two, in your normal prose), then continue — change course if they asked you to. ` +
    `This tool call was only held for the message; run it again if you still need it."`
  );
}

/** One JSON line for INBOX_MARK. */
export function inboxLine(m: InboxLine): string {
  return JSON.stringify({ id: m.id, text: m.text, at: m.at }) + "\n";
}

/** Shell that appends stdin to INBOX_MARK (used with exec { input }). */
export const INBOX_APPEND_SH = `cat >> ${INBOX_MARK}`;
/** Shell that prints and clears the delivered ids (atomic enough: rename, then read). */
export const INBOX_TAKE_DELIVERED_SH = `if [ -f ${INBOX_DELIVERED} ]; then mv ${INBOX_DELIVERED} ${INBOX_DELIVERED}.take && cat ${INBOX_DELIVERED}.take && rm -f ${INBOX_DELIVERED}.take; fi; true`;
/** Shell for the run wrapper: a fresh turn starts with no stale mail or receipts. */
export const INBOX_RESET_SH = `rm -f ${INBOX_MARK} ${INBOX_DELIVERED} ${INBOX_DELIVERED}.take`;
