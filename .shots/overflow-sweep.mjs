// Runs the overflow audit over every shell route and thread scenario at each viewport and prints one
// summary line per route: `<w>x<h> <route>  page=<n> spill=<n> scrollbar=<n>` plus each entry.
//
//   node .shots/overflow-sweep.mjs [--sizes=390x844,430x932] [--only=hub,thread:running] [--quiet]
//
// Run from PowerShell with ASB_UI set (bash mangles the leading slash of the routes).
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const flags = process.argv.slice(2);
const val = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const quiet = flags.includes("--quiet");
const sizes = val("sizes", "390x844,430x932").split(",").map((s) => s.split("x").map(Number));
const only = val("only", null)?.split(",");

const ROUTES = ["/dashboard", "/dashboard/fleet", "/dashboard/history", "/dashboard/activity", "/dashboard/skills", "/dashboard/memory", "/dashboard/harnesses", "/dashboard/integrations", "/dashboard/autopilot", "/dashboard/admin", "/dashboard/autopilot/playbooks", "/dashboard/account"];
const THREADS = [
  ["running"], ["question"], ["done"], ["sleeping"], ["idle"],
  ["running", "file"], ["running", "review"], ["running", "slash"], ["running", "mention"], ["running", "workspace"],
];

mkdirSync(".shots/ux/sweep", { recursive: true });

const run = (args, attempt = 0) => {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: process.env, timeout: 240_000 });
  if (r.status && attempt === 0) return run(args, 1);
  const lines = (r.stdout + r.stderr).split(/\r?\n/);
  const found = lines.filter((l) => l.startsWith("OVERFLOW ")).map((l) => {
    const m = /^OVERFLOW (\w+) \+(\d+)px\s+(.*)$/.exec(l);
    return m ? { kind: m[1], by: +m[2], path: m[3] } : null;
  }).filter(Boolean);
  const errors = lines.slice(lines.findIndex((l) => l.startsWith("console errors:")) + 1).filter((_, i, a) => a.length && lines.some((l) => l.startsWith("console errors:")));
  return { found, errors: lines.some((l) => l.startsWith("console errors:")) ? errors : [], status: r.status };
};

const jobs = [];
for (const r of ROUTES) jobs.push({ name: r.replace(/^\/dashboard\/?/, "") || "hub", args: (w, h) => [".shots/shell-fixture.mjs", r, `.shots/ux/sweep/${(r.replace(/^\/dashboard\/?/, "") || "hub").replace(/\//g, "_")}-${w}.png`, String(w), String(h), "--audit"] });
for (const [s, i] of THREADS) jobs.push({ name: `thread:${s}${i ? "+" + i : ""}`, args: (w, h) => [".shots/thread-fixture.mjs", s, `.shots/ux/sweep/thread-${s}${i ? "-" + i : ""}`, `--w=${w}`, `--h=${h}`, "--audit", ...(i ? [`--interact=${i}`] : [])] });

const totals = { page: 0, spill: 0, scrollbar: 0 };
for (const [w, h] of sizes) {
  for (const job of jobs) {
    if (only && !only.some((o) => job.name.includes(o))) continue;
    const { found, errors, status } = run(job.args(w, h));
    const n = { page: 0, spill: 0, scrollbar: 0 };
    for (const f of found) n[f.kind]++;
    for (const k in n) totals[k] += n[k];
    console.log(`${w}x${h} ${job.name.padEnd(26)} page=${n.page} spill=${n.spill} scrollbar=${n.scrollbar}${status ? ` EXIT ${status}` : ""}${errors.length ? ` ERRORS ${errors.length}` : ""}`);
    if (!quiet) for (const f of found) console.log(`    ${f.kind} +${f.by}px  ${f.path}`);
    if (!quiet) for (const e of errors) console.log(`    ! ${e}`);
  }
}
console.log(`TOTAL page=${totals.page} spill=${totals.spill} scrollbar=${totals.scrollbar}`);
