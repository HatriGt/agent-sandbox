/**
 * Shared JS prelude for the formatters of the drivers added after the extraction (codex, opencode).
 * The Claude and omp formatters keep their own verbatim copies — they are snapshot-locked — but the
 * helpers here are the same grammar: w() redacts and appends, df() defangs sentinels in agent text,
 * st() stamps ⟦at⟧, toolRow/result/usage write the → / indented / ⟦usage⟧ lines.
 */
import { redactShapesSource } from "../redact.js";
import {
  AT_MARK,
  ERR_MARK,
  ID_CLOSE,
  ID_OPEN,
  PLAN_CLOSE,
  PLAN_OPEN,
  RESULT_MAX_BYTES,
  RESULT_MAX_LINES,
  RESULT_MAX_LINE_CHARS,
  THINK_CLOSE,
  THINK_OPEN,
  USAGE_OPEN,
} from "./sentinels.js";

export function fmtPrelude(): string {
  return (
    `const fs=require("fs");` +
    `const out=process.argv[2];` +
    `${redactShapesSource()}\n` +
    `function w(s){try{fs.appendFileSync(out,redactShapes(String(s))+"\\n")}catch(e){}}` +
    `function df(s){return String(s).replace(/\\u27e6/g,"\\u200b\\u27e6").replace(/^\\u25cf/gm,"\\u200b\\u25cf").replace(/^\\u2192/gm,"\\u200b\\u2192")}` +
    `let inited=false;` +
    `function session(model){if(inited)return;inited=true;w("● session started (model "+String(model||"?")+")")}` +
    `function st(){w("${AT_MARK} "+Date.now())}` +
    `function oneLine(v){return df(String(v==null?"":v).replace(/\\s*\\n\\s*/g," ").trim().slice(0,200))}` +
    `function idTok(id){return id?" ${ID_OPEN}"+String(id).slice(-8)+"${ID_CLOSE}":""}` +
    `function clip(ls){const head=[];let bytes=0;for(const l0 of ls){if(head.length>=${RESULT_MAX_LINES})break;const l=l0.length>${RESULT_MAX_LINE_CHARS}?l0.slice(0,${RESULT_MAX_LINE_CHARS})+" …":l0;const b=Buffer.byteLength(l,"utf8")+3;if(head.length&&bytes+b>${RESULT_MAX_BYTES})break;bytes+=b;head.push(l)}` +
    `const cut=ls.length-head.length;if(cut>0)head.push("… "+cut+" more lines");return head}` +
    `function toolRow(name,arg,id){const a=oneLine(arg);st();w("→ "+String(name||"tool")+(a?": "+a:"")+idTok(id))}` +
    `function result(id,body,isErr){const r=String(body==null?"":body).trim();const tok=id?"${ID_OPEN}"+String(id).slice(-8)+"${ID_CLOSE} ":"";if(r||tok)st();` +
    `if(r)w("  "+tok+(isErr?"${ERR_MARK} ":"")+clip(df(r).split("\\n")).join("\\n  "));else if(tok)w("  "+tok+(isErr?"${ERR_MARK} ":"")+"(no output)")}` +
    `function say(t){t=String(t||"").trim();if(!t)return;st();w(df(t)+"\\n")}` +
    `function think(t){t=String(t||"").trim();if(t)w("${THINK_OPEN}\\n"+df(t)+"\\n${THINK_CLOSE}")}` +
    `function plan(items){if(!items.length)return;w("${PLAN_OPEN} "+Date.now()+"\\n"+items.map(i=>(i.s==="done"?"[x] ":i.s==="doing"?"[>] ":"[ ] ")+oneLine(i.t).slice(0,160)).join("\\n")+"\\n${PLAN_CLOSE}")}` +
    `function usage(inn,o,ctx){w("${USAGE_OPEN} in="+(inn||0)+" out="+(o||0)+" ctx="+(ctx||0))}` +
    `function errLine(m){st();w("${ERR_MARK} "+oneLine(m))}`
  );
}

/** The NDJSON line loop shared by every formatter: parse, dispatch to handle(e), pass prose through. */
export function fmtLoop(): string {
  return (
    `let buf="";process.stdin.setEncoding("utf8");` +
    `function line(l){l=l.trim();if(!l)return;let e;try{e=JSON.parse(l)}catch(_){w(df(l));return}if(!e||typeof e!=="object")return;try{handle(e)}catch(_){}}` +
    `process.stdin.on("data",d=>{buf+=d;let i;while((i=buf.indexOf("\\n"))>=0){line(buf.slice(0,i));buf=buf.slice(i+1)}});` +
    `process.stdin.on("end",()=>{if(buf)line(buf)});`
  );
}

/** base64 the program and decode it in the box (raw JS does not survive shell + msb-exec quoting). */
export function installJs(dir: string, file: string, js: string): string {
  const b64 = Buffer.from(js, "utf8").toString("base64");
  return `mkdir -p "${dir}" && printf '%s' '${b64}' | base64 -d > "${dir}/${file}"`;
}
