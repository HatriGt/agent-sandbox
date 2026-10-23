// Regenerates test/fixtures/drivers-snapshot.json from the live case matrix and reports which
// cases changed, so the diff is a deliberate behaviour-change record, not a blind overwrite.
import { readFileSync, writeFileSync } from "node:fs";
import { snapshotCases } from "../test/drivers-snapshot-cases.ts";

const path = "test/fixtures/drivers-snapshot.json";
const old = JSON.parse(readFileSync(path, "utf8"));
const next = snapshotCases();
const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(old[k]));
console.log("changed cases:", changed.length);
for (const k of changed) console.log("  " + k);
const onlyWrapper = changed.every((k) => k.startsWith("agentSh:"));
if (!onlyWrapper) { console.error("non-wrapper cases changed; refusing"); process.exit(1); }
writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
console.log("written", path);
