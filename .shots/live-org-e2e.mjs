// Live end-to-end for organisations against the public controller. Signs up throwaway users
// (orgtest-*), builds an org, checks what a member is served, runs one real task as the member and
// reads the box's MEMORY.md / skills dir / MCP config back, then tears the box down and deletes the
// org. Users are left for an admin to delete (they are listed at the end).
//   node .shots/live-org-e2e.mjs [--no-run] [--base=https://...]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BASE = flag("base", "https://agent-sandbox.ajeethkumar.dev");
const NO_RUN = flags.includes("--no-run");
const ts = Date.now().toString(36);
const PASS = `Org-e2e-${ts}-pass!`;
const users = {
  a: { login: `orgtest-a-${ts}`, name: "Org Test Owner", email: `orgtest-a-${ts}@example.com` },
  b: { login: `orgtest-b-${ts}`, name: "Org Test Member", email: `orgtest-b-${ts}@example.com` },
  c: { login: `orgtest-c-${ts}`, name: "Org Test Late", email: `orgtest-c-${ts}@example.com` },
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fails = [];
const check = (ok, what, extra) => {
  log(ok ? "PASS" : "FAIL", what, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : "");
  if (!ok) fails.push(what);
};

async function call(method, path, { body, cookie, bearer, raw } = {}) {
  const headers = { "content-type": "application/json", "x-requested-with": "agent-sandbox", origin: BASE };
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}
const cookieOf = (r) => (r.setCookie ?? "").split(";")[0];

async function signup(u) {
  const r = await call("POST", "/auth/signup", { body: { ...u, password: PASS } });
  if (r.status !== 200) throw new Error(`signup ${u.login}: ${r.status} ${r.text.slice(0, 200)}`);
  return cookieOf(r);
}

// ---- 1. two people
const A = await signup(users.a);
const B = await signup(users.b);
log("signed up", users.a.login, users.b.login);

// ---- 2. A starts an org, invites B (exists) and C (not yet)
const orgName = `E2E Org ${ts}`;
let r = await call("POST", "/orgs.json", { body: { name: orgName }, cookie: A });
check(r.status === 200 && r.json?.org?.role === "owner", "create org", r.json?.org);
const org = r.json.org.id;
r = await call("POST", "/orgs/members.json", { body: { org, emails: `${users.b.email}, ${users.c.email}, @${users.c.login}, @${users.b.login}` }, cookie: A });
check(r.status === 200 && r.json.added.length === 3 && r.json.existing?.includes(`@${users.b.login}`), "invite two emails and two handles: B's handle is already in, C's waits", { added: r.json?.added, existing: r.json?.existing, invalid: r.json?.invalid });
const mB = r.json.members.find((m) => m.email === users.b.email);
const mC = r.json.members.find((m) => m.email === users.c.email);
check(mB?.status === "joined" && mB.login === users.b.login, "existing user linked at once", mB);
// The "@" typeahead: B (on the site, a member now) is offered first with their standing; GitHub's
// half answers (ok) or is rate-limited (limited) - either is a working route, an error is not.
r = await call("GET", `/orgs/people-search.json?org=${org}&q=${users.b.login}`, { cookie: A });
{
  const hitB = r.json?.people?.find((p) => p.login.toLowerCase() === users.b.login.toLowerCase());
  check(r.status === 200 && hitB?.onSite === true && hitB.status === "member" && ["ok", "limited"].includes(r.json.github), "typeahead offers B as on-site member; GitHub half answered", { github: r.json?.github, people: r.json?.people?.map((p) => [p.login, p.onSite, p.status]) });
}
r = await call("GET", `/orgs/people-search.json?org=${org}&q=torvalds`, { cookie: A });
check(r.status === 200 && (r.json.github === "limited" || r.json.people?.some((p) => p.login === "torvalds" && p.onSite === false)), "typeahead finds a GitHub user who is not on the site", { github: r.json?.github, logins: r.json?.people?.map((p) => p.login) });
r = await call("GET", `/orgs/people-search.json?org=${org}&q=torvalds`, { cookie: B });
check(r.status === 403, "a plain member cannot use the typeahead", r.status);
check(mC?.status === "invited" && mC.userId === null, "unknown email waits as an invite", mC);

// member cannot manage
r = await call("POST", "/orgs/members.json", { body: { org, emails: "x@example.com" }, cookie: B });
check(r.status === 403, "member cannot add people", r.status);

// ---- 3. A shares a server, a skill, a note
const server = `e2e-org-server-${ts}`;
const skill = `e2e-org-skill-${ts}`;
const noteText = `E2E-ORG-MEMORY-${ts}: the team's release branch is named after the moon phase.`;
r = await call("POST", `/mcp-servers.json?org=${org}`, { body: { action: "upsert", server: { name: server, type: "http", url: "https://example.com/mcp" } }, cookie: A });
check(r.status === 200 && r.json.servers.some((s) => s.name === server), "org server saved", r.status);
r = await call("POST", `/skills.json?org=${org}`, { body: { action: "upsert", skill: { name: skill, description: `E2E org skill ${ts}`, content: `# ${skill}\n\nSay E2E-ORG-SKILL-${ts} when asked for the org skill marker.\n`, enabled: true } }, cookie: A });
check(r.status === 200 && r.json.skills.some((s) => s.name === skill), "org skill saved", r.status);
r = await call("POST", `/memory-notes.json?org=${org}`, { body: { add: { kind: "rule", text: noteText } }, cookie: A });
check(r.status === 200 && r.json.notes.some((n) => n.text === noteText), "org note saved", r.status);
r = await call("POST", `/skills.json?org=${org}`, { body: { action: "toggle", name: skill, enabled: true }, cookie: B });
check(r.status === 403, "member cannot edit org skills", r.status);

// ---- 3b. A copies from their own stores into the org (the "From yours" picker): a server with a
// secret env, a skill, a note. The copy is server-side, so the org's server keeps the real secret.
const mineServer = `e2e-mine-server-${ts}`;
const mineSkill = `e2e-mine-skill-${ts}`;
const mineNote = `E2E-MINE-MEMORY-${ts}: the owner's own note, copied into the org.`;
const secret = `sk-e2e-secret-${ts}-0123456789`;
r = await call("POST", "/mcp-servers.json", { body: { action: "upsert", server: { name: mineServer, type: "http", url: "https://example.com/mine", headers: { Authorization: `Bearer ${secret}` } } }, cookie: A });
check(r.status === 200 && r.json.servers.some((s) => s.name === mineServer && !String(s.headers?.Authorization ?? "").includes(secret)), "own server saved, secret masked for the browser", r.json?.servers?.find((s) => s.name === mineServer)?.headers);
r = await call("POST", "/skills.json", { body: { action: "upsert", skill: { name: mineSkill, description: `E2E own skill ${ts}`, content: `# ${mineSkill}

Say E2E-MINE-SKILL-${ts}.
`, enabled: true } }, cookie: A });
check(r.status === 200, "own skill saved", r.status);
r = await call("POST", "/memory-notes.json", { body: { add: { kind: "rule", text: mineNote } }, cookie: A });
const mineNoteId = r.json?.notes?.find((n) => n.text === mineNote)?.id;
check(r.status === 200 && !!mineNoteId, "own note saved", mineNoteId);
r = await call("POST", "/orgs/copy.json", { body: { org, servers: [mineServer, "no-such-server"], skills: [mineSkill], notes: [mineNoteId] }, cookie: B });
check(r.status === 403, "member cannot copy into the org", r.status);
r = await call("POST", "/orgs/copy.json", { body: { org, servers: [mineServer, "no-such-server"], skills: [mineSkill], notes: [mineNoteId] }, cookie: A });
check(r.status === 200 && r.json.copied?.servers?.length === 1 && r.json.copied.skills.length === 1 && r.json.copied.notes === 1, "owner copies own server, skill and note into the org", r.json?.copied);
r = await call("GET", `/mcp-servers.json?org=${org}`, { cookie: A });
check(r.json?.servers?.some((s) => s.name === mineServer), "org now lists the copied server");
r = await call("GET", `/skills.json?org=${org}`, { cookie: A });
check(r.json?.skills?.some((s) => s.name === mineSkill), "org now lists the copied skill");
r = await call("GET", `/memory-notes.json?org=${org}`, { cookie: A });
check(r.json?.notes?.some((n) => n.text === mineNote), "org now lists the copied note");
r = await call("POST", "/orgs/copy.json", { body: { org }, cookie: A });
check(r.status === 400, "copy with nothing picked is refused", r.status);

// ---- 4. what B is served
r = await call("GET", "/mcp-servers.json", { cookie: B });
const sharedServers = r.json?.shared?.find((g) => g.org.id === org);
check(!!sharedServers && sharedServers.servers.some((s) => s.name === server) && sharedServers.org.role === "member", "B sees the org server as shared", sharedServers?.org);
check(!!sharedServers?.servers.some((s) => s.name === mineServer && !String(s.headers?.Authorization ?? "").includes(secret)), "B sees the copied server, secret masked");
r = await call("GET", "/skills.json", { cookie: B });
check(!!r.json?.shared?.find((g) => g.org.id === org)?.skills.some((s) => s.name === skill), "B sees the org skill as shared");
r = await call("GET", "/memory-notes.json", { cookie: B });
check(!!r.json?.shared?.find((g) => g.org.id === org)?.notes.some((n) => n.text === noteText), "B sees the org note as shared");
check(!r.json?.notes?.some((n) => n.text === noteText), "org note is not in B's own notes");
r = await call("GET", "/me.json", { cookie: B });
check(r.json?.orgs?.some((o) => o.id === org && o.role === "member"), "B's /me lists the org", r.json?.orgs);

// ---- 5. C signs up with the invited address and is in
const C = await signup(users.c);
r = await call("GET", "/me.json", { cookie: C });
check(r.json?.orgs?.some((o) => o.id === org), "late sign-up with the invited email joins", r.json?.orgs);
r = await call("GET", `/orgs/members.json?org=${org}`, { cookie: A });
check(r.json?.members.find((m) => m.email === users.c.email)?.status === "joined", "C shows as joined to the owner");
check(r.json?.members.filter((m) => m.login === users.c.login).length === 1, "C invited by email and handle is one member, not two", r.json?.members.map((m) => [m.email, m.status]));
r = await call("GET", "/me.json", { cookie: C });
check(r.json?.orgs?.filter((o) => o.id === org).length === 1, "C's /me lists the org once");

// ---- 6. a real run as B: what reached the box?
let box = null;
let keyId = null;
if (!NO_RUN) {
  r = await call("POST", "/api-keys.json", { body: { name: "org-e2e" }, cookie: B });
  check(r.status === 200 && r.json.token, "B gets an API key");
  keyId = r.json.id;
  const key = r.json.token;
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } });
  const client = new Client({ name: "org-e2e", version: "1" });
  await client.connect(transport);
  const task =
    "This is a verification task, not a coding task. Do not call any MCP tool. Run exactly this shell command and reply with its complete raw output, nothing else:\n" +
    "echo ===MEMORY===; cat /root/.claude/MEMORY.md 2>&1 | head -80; echo ===SKILLS===; ls /root/.claude/skills 2>&1; echo ===MCP===; cat /root/.agent-mcp.json 2>&1 | head -60";
  log("delegating a task as", users.b.login);
  const started = Date.now();
  const result = await client.callTool({ name: "delegate", arguments: { task } }, undefined, { timeout: 15 * 60 * 1000 });
  const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
  log(`delegate returned after ${Math.round((Date.now() - started) / 1000)}s:`, text.slice(0, 400).replace(/\n/g, " | "));
  box = text.match(/session[:= ]+"?([a-z0-9-]+)/i)?.[1] ?? text.match(/\b(pool-\d+-[a-z0-9]+|box-[a-z0-9-]+)\b/)?.[1] ?? null;
  log("box", box);
  // The reply may be summarised; pull the box's log via watch for the raw command output too.
  let seen = text;
  if (box) {
    try {
      const w = await client.callTool({ name: "watch", arguments: { session: box, lines: 400 } });
      seen += "\n" + (w.content ?? []).map((c) => c.text ?? "").join("\n");
    } catch (e) {
      log("watch failed", String(e).slice(0, 120));
    }
  }
  const { writeFileSync } = await import("node:fs");
  writeFileSync(".shots/eq-meta.txt", seen);
  log("full box output written to .shots/eq-meta.txt", seen.length, "chars");
  check(seen.includes(`E2E-ORG-MEMORY-${ts}`), "org memory note reached the box's MEMORY.md");
  check(seen.includes(skill), "org skill directory reached the box");
  check(seen.includes(server), "org MCP server reached the box's MCP config");
  check(seen.includes(mineServer), "copied server reached the box's MCP config");
  // The watch log is redacted by the controller, which knows the real value and prints it as
  // `Bearer …<last 4>`; the browser mask (`Be…789`) would have come through untouched.
  check(seen.includes(`Bearer \u2026${secret.slice(-4)}`) && !seen.includes(`Bearer ${secret.slice(0, 2)}\u2026${secret.slice(-3)}`), "copied server carries the real secret in the box (redacted in the log, not the browser mask)");
  check(seen.includes(mineSkill), "copied skill directory reached the box");
  check(seen.includes(`E2E-MINE-MEMORY-${ts}`), "copied note reached the box's MEMORY.md");
  if (box) {
    const t = await call("POST", "/teardown.json", { body: { box }, cookie: B });
    check(t.status === 200, "teardown of the test box", t.status);
  }
  await client.close().catch(() => {});
  if (keyId) await call("DELETE", "/api-keys.json", { body: { id: keyId }, cookie: B });
}

// ---- 7. cleanup: delete the org; B's shared view empties
r = await call("DELETE", "/orgs.json", { body: { org }, cookie: B });
check(r.status === 403, "member cannot delete the org", r.status);
r = await call("DELETE", "/orgs.json", { body: { org }, cookie: A });
check(r.status === 200, "owner deletes the org", r.status);
r = await call("GET", "/skills.json", { cookie: B });
check(!(r.json?.shared ?? []).some((g) => g.org.id === org), "nothing shared after delete");

log(fails.length ? `FAILED: ${fails.join("; ")}` : "ALL PASSED");
log("test users to delete from Admin:", Object.values(users).map((u) => u.login).join(", "));
process.exit(fails.length ? 1 : 0);
