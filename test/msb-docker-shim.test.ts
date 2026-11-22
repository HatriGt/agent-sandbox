import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The Docker-backed msb shim (src/host-shim/msb-docker.py), driven as the controller drives it, with
// a fake docker (MSB_DOCKER, a Python script) that records every call and answers `inspect` with a
// running container. Needs a python3; skipped where there is none (the shim never runs there).

const SHIM = path.resolve("src/host-shim/msb-docker.py");

function python(): string | null {
  for (const p of ["python3", "python"]) {
    const r = spawnSync(p, ["--version"], { encoding: "utf8" });
    if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return p;
  }
  return null;
}

function fakeDocker(dir: string): { log: string; cmd: string } {
  const log = path.join(dir, "calls.log");
  const script = path.join(dir, "fake-docker.py");
  fs.writeFileSync(
    script,
    [
      "import json, sys",
      `open(${JSON.stringify(log)}, "a").write(" ".join(sys.argv[1:]) + "\\n")`,
      "if sys.argv[1] == 'inspect':",
      "    print(json.dumps([{'Id': 'abc', 'Name': '/box', 'State': {'Status': 'running'}, 'Config': {'Labels': {}}}]))",
      "",
    ].join("\n")
  );
  return { log, cmd: script };
}

function runShim(py: string, fake: { cmd: string }, args: string[]) {
  // A quoted path: MSB_DOCKER is split like a shell command line.
  return spawnSync(py, ["-I", SHIM, ...args], { encoding: "utf8", env: { ...process.env, MSB_DOCKER: `${JSON.stringify(py)} ${JSON.stringify(fake.cmd)}` } });
}

const calls = (log: string) => fs.readFileSync(log, "utf8").trim().split("\n");

test("shim: `copy -q FILE box:DEST` is one docker cp of the file (the rescue upload's exact call)", (t) => {
  const py = python();
  if (!py) return t.skip("no python3 on this machine");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-"));
  const fake = fakeDocker(dir);
  const file = path.join(dir, "t3.tar.gz");
  fs.writeFileSync(file, "x");
  const r = runShim(py, fake, ["copy", "-q", file, "box:/tmp/restore.tar.gz"]);
  assert.equal(r.status, 0, r.stderr);
  const c = calls(fake.log);
  assert.ok(c.some((l) => l.startsWith("cp ") && l.endsWith(" box:/tmp/restore.tar.gz") && l.includes("t3.tar.gz")), c.join(" | "));
  assert.ok(!c.some((l) => l.includes("/.")), "a file is copied as is, never as DIR/.");
});

test("shim: a directory copy still fills an existing DEST with DIR/.", (t) => {
  const py = python();
  if (!py) return t.skip("no python3 on this machine");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-"));
  const fake = fakeDocker(dir);
  const src = path.join(dir, "tree");
  fs.mkdirSync(src);
  const r = runShim(py, fake, ["copy", src, "box:/workspace"]);
  assert.equal(r.status, 0, r.stderr);
  const c = calls(fake.log);
  assert.ok(c.some((l) => l.startsWith("cp ") && l.includes("tree/. box:/workspace")), c.join(" | "));
});

test("shim: a missing source and a flag-only call are refused with a reason", (t) => {
  const py = python();
  if (!py) return t.skip("no python3 on this machine");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shim-"));
  const fake = fakeDocker(dir);
  const missing = runShim(py, fake, ["copy", "-q", path.join(dir, "nope"), "box:/x"]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /is not on the host/);
  const flags = runShim(py, fake, ["copy", "-q"]);
  assert.equal(flags.status, 2);
  assert.match(flags.stderr, /usage is copy SRC box:DEST/);
});
