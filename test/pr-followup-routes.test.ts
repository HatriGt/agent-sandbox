import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import { FOLLOWUP_HOOK_EVENTS, parseInstallTarget, registerFollowupRoutes } from "../src/pr-followup-routes.ts";
import { hookOf, installsOf, revealHookSecret } from "../src/pr-followup-store.ts";
import type { GhRequest } from "../src/pr-followup-engine.ts";

const box = makeSecretBox(crypto.randomBytes(32));

function setup(opts: { hooks?: Array<{ id: number; config: { url: string } }>; fail?: string } = {}) {
  const db = openMemoryDb();
  const calls: Array<{ repo: string } & GhRequest> = [];
  const app = express();
  app.use(express.json());
  registerFollowupRoutes(app, {
    db,
    box,
    engine: { claims: () => ({ ok: false, reason: "n/a" }), handle: async () => ({ handled: false, reason: "n/a" }) } as never,
    dashAuthed: () => true,
    principalOf: () => ({ kind: "user", userId: "u1" }) as never,
    failWith: (res, e) => void res.status(500).json({ error: String((e as Error).message ?? e) }),
    loadPrefs: () => ({ keepGreen: true, addressReviews: true, commandAnywhere: true }),
    savePrefs: () => {},
    publicUrl: "https://asb.test/",
    audit: () => {},
    gh: async (_owner, repo, req) => {
      calls.push({ repo, ...req });
      if (opts.fail) throw new Error(opts.fail);
      if ((req.method ?? "GET") === "GET") return opts.hooks ?? [];
      if (req.method === "POST") return { id: 4242 };
      return null;
    },
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => (await fetch(base + p)).json() as Promise<any>;
  const post = async (p: string, body: unknown) => {
    const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { db, calls, get, post, close: () => server.close() };
}

test("parseInstallTarget: an org, a repo, or either as a URL; anything else is refused", () => {
  assert.deepEqual(parseInstallTarget("acme"), { kind: "org", target: "acme", hooksPath: "/orgs/acme/hooks", repoHint: "acme/-" });
  assert.deepEqual(parseInstallTarget(" https://github.com/acme/app.git/ "), { kind: "repo", target: "acme/app", hooksPath: "/repos/acme/app/hooks", repoHint: "acme/app" });
  assert.equal(parseInstallTarget("a/b/c"), undefined);
  assert.equal(parseInstallTarget("../etc"), undefined);
  assert.equal(parseInstallTarget(""), undefined);
  assert.equal(parseInstallTarget("acme/app?x=1"), undefined);
});

test("install: one click creates the org webhook with the owner's hook URL + secret and every follow-up event; it is listed, and removed again", async () => {
  const s = setup();
  try {
    const r = await s.post("/pr-followups/install.json", { target: "acme" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.install, { target: "acme", kind: "org", createdAt: r.body.install.createdAt });
    assert.equal(r.body.updated, false);
    // The hook was minted on the way (none existed), and GitHub got its URL and secret.
    const h = hookOf(s.db, "u1")!;
    const secret = revealHookSecret(s.db, box, h.id)!;
    const list = s.calls.find((c) => (c.method ?? "GET") === "GET")!;
    assert.equal(list.path, "/orgs/acme/hooks?per_page=100");
    assert.equal(list.repo, "acme/-");
    const create = s.calls.find((c) => c.method === "POST")!;
    assert.equal(create.path, "/orgs/acme/hooks");
    assert.deepEqual(create.body, {
      name: "web",
      active: true,
      events: FOLLOWUP_HOOK_EVENTS,
      config: { url: `https://asb.test/hooks/prs/${h.id}/${secret}`, content_type: "json", secret, insecure_ssl: "0" },
    });
    assert.deepEqual(installsOf(s.db, "u1").map((i) => [i.target, i.kind, i.ghHookId]), [["acme", "org", 4242]]);
    assert.deepEqual((await s.get("/pr-followups.json")).installs.map((i: any) => i.target), ["acme"]);

    const u = await s.post("/pr-followups/uninstall.json", { target: "acme" });
    assert.equal(u.status, 200);
    const del = s.calls.find((c) => c.method === "DELETE")!;
    assert.equal(del.path, "/orgs/acme/hooks/4242");
    assert.deepEqual(installsOf(s.db, "u1"), []);
    assert.equal((await s.post("/pr-followups/uninstall.json", { target: "acme" })).status, 404);
  } finally {
    s.close();
  }
});

test("install: a repo whose hook GitHub already has (same payload URL) is updated in place, not duplicated; bad targets and missing rights are explained", async () => {
  const s0 = setup();
  let hookId = "";
  try {
    await s0.post("/pr-followups/hook.json", {});
    hookId = hookOf(s0.db, "u1")!.id;
  } finally {
    s0.close();
  }
  const s = setup({ hooks: [{ id: 7, config: { url: "https://asb.test/hooks/prs/OTHER/x" } }, { id: 9, config: { url: `https://asb.test/hooks/prs/${hookId}/old` } }] });
  try {
    // Same hook id as before, so GitHub's hook 9 is ours.
    s.db.prepare(`INSERT INTO pr_followup_hooks (id, owner, secret_enc, created_at) VALUES (?, ?, ?, ?)`).run(hookId, "u1", box.seal("sec"), 1);
    const r = await s.post("/pr-followups/install.json", { repo: "acme/app" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.updated, true);
    const patch = s.calls.find((c) => c.method === "PATCH")!;
    assert.equal(patch.path, "/repos/acme/app/hooks/9");
    assert.equal((patch.body as any).config.url, `https://asb.test/hooks/prs/${hookId}/sec`);
    assert.ok(!s.calls.some((c) => c.method === "POST"));
    assert.deepEqual(installsOf(s.db, "u1").map((i) => [i.target, i.kind, i.ghHookId]), [["acme/app", "repo", 9]]);

    assert.equal((await s.post("/pr-followups/install.json", { target: "a/b/c" })).status, 400);
  } finally {
    s.close();
  }
  const s2 = setup({ fail: "GitHub answered 404" });
  try {
    const r = await s2.post("/pr-followups/install.json", { target: "acme" });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /administer/);
    assert.deepEqual(installsOf(s2.db, "u1"), []);
  } finally {
    s2.close();
  }
});
