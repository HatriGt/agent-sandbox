// Regenerate test/fixtures/drivers-snapshot.json after a deliberate prompt change, and report
// which cases changed and by what, so the diff is provably only the intended sentence.
import { readFileSync, writeFileSync } from "node:fs";
import { snapshotCases } from "../test/drivers-snapshot-cases.ts";

const path = "test/fixtures/drivers-snapshot.json";
const before = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const after = snapshotCases();
const changed: string[] = [];
for (const k of Object.keys(after)) {
  const a = JSON.stringify(before[k]) ?? "";
  const b = JSON.stringify(after[k]);
  if (a === b) continue;
  changed.push(k);
  if (!a) {
    console.log(`${k}: new case (${b.length} chars)`);
    continue;
  }
  // Byte delta and the inserted text, for the eye.
  const delta = b.length - a.length;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  console.log(`${k}: ${delta >= 0 ? "+" : ""}${delta} chars; inserted: ${JSON.stringify(b.slice(i, i + delta + 20))}`);
}
console.log(`changed cases: ${changed.length} of ${Object.keys(after).length}`);
writeFileSync(path, JSON.stringify(after, null, 2) + "\n");
