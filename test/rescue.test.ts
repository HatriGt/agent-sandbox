/**
 * Rescue copies (src/rescue.ts): the pure command builders, the capture-result parser, and the
 * pull/push/sweep flows against an in-memory IO seam and a temp data dir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { capturedTurn, dropRescue, listRescues, pullRescue, pushRescue, readRescue, restoreSh, sizeProbeSh, pullSh, sweepRescues, type RescueIO } from "../src/rescue.ts";
import type { Config } from "../src/config.ts";

const tmpCfg = async (): Promise<Config> => ({ dataDir: await fs.mkdtemp(path.join(os.tmpdir(), "asb-rescue-")), msb: "msb", vpsSsh: "root@host", hostId: "h1" }) as unknown as Config;

test("capturedTurn reads the checkpoint result: OK is a fresh tar, HAVE an existing one", () => {
  assert.deepEqual(capturedTurn("CKPT_OK t7\n"), { turn: 7, fresh: true });
  assert.deepEqual(capturedTurn("noise\nCKPT_HAVE t12"), { turn: 12, fresh: false });
  assert.equal(capturedTurn("tar: error"), undefined);
});

test("the in-box commands name the checkpoint tar and the restore wipes, untars at /, claims, and seams the log", () => {
  assert.match(sizeProbeSh(3), /\/root\/\.agent-ckpt\/t3\.tar/);
  assert.match(sizeProbeSh(3), /stat -c %s/);
  assert.match(pullSh(3), /^gzip -1 -c '\/root\/\.agent-ckpt\/t3\.tar'$/);
  const r = restoreSh(5, Date.UTC(2026, 10, 18, 12, 6));
  assert.match(r, /rm -rf \/workspace \/root\/\.claude/);
  assert.match(r, /gzip -dc \| tar -xf - -C \//);
  assert.match(r, /touch \/\.claimed/);
  assert.match(r, /brought back from a copy taken after turn 5/);
  assert.match(r, /2026-11-18 12:06 UTC/);
  assert.match(r, />> \/workspace\/\.agent\.log/);
  assert.match(r, /echo RESTORED t5$/);
});

function fakeIO(sizes: Record<number, number | "MISSING">, payload = "gz-bytes"): RescueIO & { pulled: string[]; pushed: Array<{ sh: string; file: string }> } {
  const io = {
    pulled: [] as string[],
    pushed: [] as Array<{ sh: string; file: string }>,
    exec: async (_c: Config, _b: string, sh: string) => {
      const m = sh.match(/t(\d+)\.tar/);
      const s = sizes[Number(m![1])];
      return { stdout: s === undefined ? "MISSING\n" : `${s}\n` };
    },
    pull: async (_c: Config, _b: string, sh: string, file: string) => {
      io.pulled.push(sh);
      await fs.writeFile(file, payload);
      return { code: 0, stderr: "", bytes: payload.length };
    },
    push: async (_c: Config, _b: string, sh: string, file: string) => {
      io.pushed.push({ sh, file });
      return { code: 0, stderr: "", stdout: "RESTORED t2\n" };
    },
  };
  return io;
}

test("pullRescue keeps ONE copy per box: the newest turn replaces the older, the same turn is not pulled twice", async () => {
  const cfg = await tmpCfg();
  const io = fakeIO({ 1: 1000, 2: 2000 });
  const m1 = await pullRescue(cfg, "pool-1-abc", 1, { owner: "u1", agent: "claude", task: "fix it", hostId: "h1" }, io);
  assert.ok(m1 && m1.turn === 1 && m1.bytes === 8 && m1.owner === "u1");
  assert.equal(io.pulled.length, 1);
  // Same turn again: a file read, no pull.
  await pullRescue(cfg, "pool-1-abc", 1, {}, io);
  assert.equal(io.pulled.length, 1);
  const m2 = await pullRescue(cfg, "pool-1-abc", 2, { owner: "u1" }, io);
  assert.ok(m2 && m2.turn === 2);
  assert.equal(io.pulled.length, 2);
  const files = (await fs.readdir(path.join(cfg.dataDir, "rescue", "pool-1-abc"))).sort();
  assert.deepEqual(files, ["meta.json", "t2.tar.gz"]);
  const read = await readRescue(cfg, "pool-1-abc");
  assert.equal(read?.turn, 2);
  assert.equal((await listRescues(cfg))[0]?.box, "pool-1-abc");
});

test("pullRescue skips a checkpoint over the size limit and says so, keeping the older copy", async () => {
  const cfg = await tmpCfg();
  const io = fakeIO({ 1: 1000, 2: 900 * 1024 * 1024 });
  await pullRescue(cfg, "pool-2-abc", 1, {}, io);
  const m = await pullRescue(cfg, "pool-2-abc", 2, {}, io);
  assert.ok(m);
  assert.equal(m.tooBig, 900 * 1024 * 1024);
  assert.equal(m.turn, 1, "the copy on disk is still turn 1");
  assert.equal(io.pulled.length, 1);
  assert.ok(await fs.stat(path.join(cfg.dataDir, "rescue", "pool-2-abc", "t1.tar.gz")));
});

test("pullRescue with no such checkpoint in the box leaves what is there", async () => {
  const cfg = await tmpCfg();
  const io = fakeIO({});
  assert.equal(await pullRescue(cfg, "pool-3-abc", 4, {}, io), null);
  assert.equal(await readRescue(cfg, "pool-3-abc"), null);
});

test("pushRescue feeds the kept tar to the restore command and demands the box's confirmation", async () => {
  const cfg = await tmpCfg();
  const io = fakeIO({ 2: 500 });
  const m = await pullRescue(cfg, "pool-4-abc", 2, {}, io);
  await pushRescue(cfg, "pool-4-abc", m!, Date.now(), io);
  assert.equal(io.pushed.length, 1);
  assert.match(io.pushed[0].sh, /RESTORED t2/);
  assert.match(io.pushed[0].file, /t2\.tar\.gz$/);
  const silent: RescueIO = { ...io, push: async () => ({ code: 0, stderr: "", stdout: "" }) };
  await assert.rejects(pushRescue(cfg, "pool-4-abc", m!, Date.now(), silent), /did not confirm/);
});

test("dropRescue removes the copy; sweepRescues removes copies past the TTL and keeps the rest", async () => {
  const cfg = await tmpCfg();
  const io = fakeIO({ 1: 10 });
  await pullRescue(cfg, "pool-5-old", 1, {}, io);
  await pullRescue(cfg, "pool-5-new", 1, {}, io);
  // Age the first copy by rewriting its meta.
  const dir = path.join(cfg.dataDir, "rescue", "pool-5-old");
  const meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
  meta.at = Date.now() - 20 * 86_400_000;
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
  assert.equal(await sweepRescues(cfg), 1);
  assert.equal(await readRescue(cfg, "pool-5-old"), null);
  assert.ok(await readRescue(cfg, "pool-5-new"));
  await dropRescue(cfg, "pool-5-new");
  assert.equal(await readRescue(cfg, "pool-5-new"), null);
});
