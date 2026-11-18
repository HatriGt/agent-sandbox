import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.js";
import { createPasswordUser, upsertGithubUser, updateProfile, deleteUser } from "../src/identity.js";
import { makeSecretBox } from "../src/secretbox.js";
import { loadBlob, registerSharedOwners, registerUserStoreBackend, saveBlob, sharedOwners, withOwner, ownerKey } from "../src/user-store.js";
import { addMembers, createOrg, deleteOrg, followNote, followServer, followSkill, leaveOrg, listMembers, mergeMcpStores, mergeMemoryStores, mergeSkillStores, orgRole, orgsOf, parseEmails, removeMember, setMemberRole, sharedOrgIds, transferOrg, ORG_LIMITS, searchUsersByLogin } from "../src/orgs.js";
import { loadMemoryStore, saveMemoryStore, addManualNote, emptyMemoryStore, selectMemory, markUsed } from "../src/memory-store.js";
import type { McpStore } from "../src/mcp-store.js";
import type { SkillDef, SkillStore } from "../src/skill-store.js";
import type { MemoryNote } from "../src/memory-store.js";

const user = (db: ReturnType<typeof openMemoryDb>, login: string, email: string | null) => createPasswordUser(db, { login, name: login, email, password: "a-long-enough-password" });

test("parseEmails: pasted lists in any shape become unique lowercase addresses", () => {
  const r = parseEmails("Ann <Ann@Example.com>, bob@example.com; carol@example.com\nann@example.com not-an-email");
  assert.deepEqual(r.emails, ["ann@example.com", "bob@example.com", "carol@example.com"]);
  assert.deepEqual(r.invalid, ["not-an-email"]);
});

test("an invite by email links when that person shows up — before or after the invite", () => {
  const db = openMemoryDb();
  const owner = user(db, "owner", "owner@acme.test");
  const early = user(db, "early", "early@acme.test"); // already signed up when invited
  const org = createOrg(db, owner.id, "  Acme   Robotics ");
  assert.equal(org.name, "Acme Robotics");
  const r = addMembers(db, org.id, "early@acme.test, Late@acme.test, owner@acme.test, junk", owner.id);
  assert.deepEqual(r.added, ["early@acme.test", "late@acme.test"]);
  assert.deepEqual(r.existing, ["owner@acme.test"], "the owner's own address is never a member row");
  assert.deepEqual(r.invalid, ["junk"]);
  assert.equal(orgRole(db, org.id, early.id), "member", "an existing user is in the moment they are invited");
  assert.equal(orgRole(db, org.id, owner.id), "owner");

  // The late one signs up later with the invited address (GitHub this time).
  const late = upsertGithubUser(db, { githubId: "42", login: "late", email: "late@acme.test" });
  assert.equal(orgRole(db, org.id, late.id), "member", "invite links on first lookup");
  const members = listMembers(db, org.id);
  assert.deepEqual(members.map((m) => [m.email, m.role, m.status]), [
    ["owner@acme.test", "owner", "joined"],
    ["early@acme.test", "member", "joined"],
    ["late@acme.test", "member", "joined"],
  ]);
  const view = orgsOf(db, late.id);
  assert.equal(view.length, 1);
  assert.equal(view[0].members, 3);
  assert.equal(view[0].pending, 0);

  // Someone with no email yet: not in. Setting the email on the account is enough.
  const nomail = user(db, "nomail", null);
  addMembers(db, org.id, "nomail@acme.test", owner.id);
  assert.equal(orgRole(db, org.id, nomail.id), null);
  assert.equal(orgsOf(db, owner.id)[0].pending, 1);
  updateProfile(db, nomail.id, { email: "NoMail@acme.test" });
  assert.equal(orgRole(db, org.id, nomail.id), "member");
});

test("the typeahead's local half: logins by prefix, shortest first, LIKE wildcards escaped", () => {
  const db = openMemoryDb();
  upsertGithubUser(db, { githubId: "11", login: "Devon", email: null });
  upsertGithubUser(db, { githubId: "12", login: "dev-priya", email: "p@acme.test" });
  upsertGithubUser(db, { githubId: "13", login: "andev", email: null });
  upsertGithubUser(db, { githubId: "14", login: "dev_underscore", email: null });
  assert.deepEqual(searchUsersByLogin(db, "dev").map((p) => p.login), ["Devon", "dev-priya", "dev_underscore"]);
  assert.deepEqual(searchUsersByLogin(db, "dev_").map((p) => p.login), ["dev_underscore"], "an underscore is literal, not a wildcard");
  assert.deepEqual(searchUsersByLogin(db, "%").map((p) => p.login), [], "a percent sign is literal too");
  assert.equal(searchUsersByLogin(db, "d", 2).length, 2);
  assert.ok(searchUsersByLogin(db, "DEV").every((p) => p.onSite));
});

test("an invite by GitHub handle: links at once for someone who never set an email, later for the rest, and never twice", () => {
  const db = openMemoryDb();
  const owner = user(db, "owner", "owner@acme.test");
  const org = createOrg(db, owner.id, "Acme");
  // Signed in with GitHub, email kept private: no address to invite, only the handle.
  const quiet = upsertGithubUser(db, { githubId: "7", login: "Quiet-Dev", email: null });
  assert.equal(parseEmails("@Quiet-Dev @bad--name @-x ann@acme.test").invalid.join(","), "@bad--name,@-x");
  const r = addMembers(db, org.id, "@Quiet-Dev, @owner, @nobody-yet", owner.id);
  assert.deepEqual(r.added, ["@quiet-dev", "@nobody-yet"]);
  assert.deepEqual(r.existing, ["@owner"], "the owner's own handle is never a member row");
  assert.equal(orgRole(db, org.id, quiet.id), "member", "a handle links the moment it is added");
  assert.equal(listMembers(db, org.id).find((m) => m.email === "@quiet-dev")?.login, "Quiet-Dev");

  // The same person by their other key is "existing", not a second row.
  updateProfile(db, quiet.id, { email: "quiet@acme.test" });
  assert.deepEqual(addMembers(db, org.id, "quiet@acme.test", owner.id).existing, ["quiet@acme.test"]);

  // Invited by handle AND email before signing up: one membership once they do.
  addMembers(db, org.id, "nobody-yet@acme.test", owner.id);
  assert.equal(orgsOf(db, owner.id)[0].pending, 2);
  const late = upsertGithubUser(db, { githubId: "8", login: "nobody-yet", email: "nobody-yet@acme.test" });
  assert.equal(orgRole(db, org.id, late.id), "member");
  assert.equal(listMembers(db, org.id).filter((m) => m.userId === late.id).length, 1, "one row, the redundant invite dropped");
  assert.equal(orgsOf(db, late.id).length, 1, "the org is listed once");
  assert.equal(orgsOf(db, owner.id)[0].pending, 0);
});

test("roles, removal, leaving, hand-over and deletion", () => {
  const db = openMemoryDb();
  const owner = user(db, "owner", "o@x.test");
  const a = user(db, "a", "a@x.test");
  const b = user(db, "b", "b@x.test");
  const org = createOrg(db, owner.id, "Team");
  addMembers(db, org.id, "a@x.test b@x.test", owner.id);
  assert.equal(setMemberRole(db, org.id, "a@x.test", "admin"), true);
  assert.equal(orgRole(db, org.id, a.id), "admin");
  assert.equal(leaveOrg(db, org.id, b.id), true);
  assert.equal(orgRole(db, org.id, b.id), null);
  assert.equal(removeMember(db, org.id, "nobody@x.test"), false);
  // Hand-over: a becomes owner, the old owner stays as an admin.
  assert.equal(transferOrg(db, org.id, b.id), false, "b left — cannot receive");
  assert.equal(transferOrg(db, org.id, a.id), true);
  assert.equal(orgRole(db, org.id, a.id), "owner");
  assert.equal(orgRole(db, org.id, owner.id), "admin");
  assert.equal(orgsOf(db, a.id)[0].role, "owner");
  // Owner limit.
  for (let i = 0; i < ORG_LIMITS.maxOwned; i++) createOrg(db, b.id, `T${i}`);
  assert.throws(() => createOrg(db, b.id, "one more"), /already own/);
  assert.throws(() => createOrg(db, b.id, "x"), /characters/);
  // Deleting a member's account leaves the invite waiting for whoever has that email next.
  assert.equal(deleteUser(db, owner.id), true);
  assert.equal(listMembers(db, org.id).find((m) => m.email === "o@x.test")?.status, "invited");
  assert.equal(deleteOrg(db, org.id), true);
  assert.equal(orgsOf(db, a.id).length, 0);
});

test("merges: own entries win, disabled org entries stay out, org memory is read but never saved into the member's row", () => {
  const db = openMemoryDb();
  registerUserStoreBackend({ db, box: makeSecretBox(crypto.randomBytes(32)) });
  const owner = user(db, "owner", "o@m.test");
  const m = user(db, "m", "m@m.test");
  const org = createOrg(db, owner.id, "Shared");
  addMembers(db, org.id, "m@m.test", owner.id);
  registerSharedOwners((o) => sharedOrgIds(db, o));
  assert.deepEqual(withOwner(m.id, () => sharedOwners()), [org.id]);
  assert.deepEqual(withOwner(org.id, () => sharedOwners()), [], "an org never resolves to further orgs");
  assert.deepEqual(sharedOwners("operator"), []);

  const srv = (name: string, enabled = true) => ({ name, type: "http" as const, url: `https://${name}.example`, enabled, addedAt: 1 });
  const own: McpStore = { servers: { jira: srv("jira") } };
  const shared: McpStore[] = [{ servers: { jira: { ...srv("jira"), url: "https://org-jira" }, slack: srv("slack"), off: srv("off", false) } }, { servers: { slack: { ...srv("slack"), url: "https://second-org" }, db: srv("db") } }];
  const merged = mergeMcpStores(own, shared);
  assert.deepEqual(Object.keys(merged.servers).sort(), ["db", "jira", "slack"]);
  assert.equal(merged.servers.jira.url, "https://jira.example", "the member's own server wins");
  assert.equal(merged.servers.slack.url, "https://slack.example", "the first org wins between orgs");

  const skill = (name: string, enabled = true) => ({ name, description: name, content: "# " + name, enabled, addedAt: 1, updatedAt: 1 });
  const ownS: SkillStore = { skills: { deploy: skill("deploy") } };
  const mergedS = mergeSkillStores(ownS, [{ skills: { deploy: skill("deploy"), review: skill("review"), hidden: skill("hidden", false) } }]);
  assert.deepEqual(Object.keys(mergedS.skills).sort(), ["deploy", "review"]);

  // Memory: the org's notes ride along for selection; counters land on the member's own objects.
  withOwner(org.id, () => {
    const s = emptyMemoryStore();
    addManualNote(s, { kind: "rule", text: "When deploying, run the smoke test first" });
    saveMemoryStore(s);
  });
  withOwner(m.id, () => {
    const s = emptyMemoryStore();
    addManualNote(s, { kind: "preference", text: "Keep replies short" });
    saveMemoryStore(s);
  });
  withOwner(m.id, () => {
    const ownM = loadMemoryStore();
    const all = mergeMemoryStores(ownM, sharedOwners().map((o) => loadMemoryStore(o)));
    assert.equal(all.global.length, 2);
    assert.equal(ownM.global.length, 1, "own store untouched");
    const sel = selectMemory(all, [], "deploy the service");
    assert.ok(sel.core.length >= 1 || sel.picked.length >= 1, "the org's rule is served to the member's run");
    markUsed(all.global); // what installMemory does to the selection: counters on the merged objects
    saveMemoryStore(ownM);
    const again = loadMemoryStore();
    assert.equal(again.global.length, 1, "no org note was copied into the member's row");
    assert.ok((again.global[0].uses ?? 0) >= 1, "the merged store shares the member's note objects, so the counter landed on their row");
    // An org whose memory switch is off contributes nothing.
    const off = { ...loadMemoryStore(org.id), enabled: false };
    assert.equal(mergeMemoryStores(ownM, [off]).global.length, 1);
  });
  // Deleting the org deletes its stores.
  withOwner(org.id, () => saveBlob("mcp", JSON.stringify(own)));
  assert.ok(loadBlob("mcp", org.id));
  deleteOrg(db, org.id);
  assert.equal(loadBlob("mcp", org.id), null);
  assert.equal(ownerKey(), "operator");
});

const who = { user: "u1", login: "ann" };
const skill = (name: string, content: string, extra: Partial<SkillDef> = {}): SkillDef => ({ name, description: `about ${name}`, content, enabled: true, addedAt: 1, updatedAt: 1, ...extra });

test("followSkill: a stamped org copy follows its source's edits and renames, keeps the org's switch, survives the source's removal", () => {
  const org: SkillStore = { skills: { review: { ...skill("review", "v1"), enabled: false, addedAt: 7, from: { user: "u1", login: "ann", name: "review", at: 1 } } } };
  // Edited: content follows; the org's own enabled/addedAt stay.
  assert.equal(followSkill(org, who, "review", skill("review", "v1"), skill("review", "v2", { updatedAt: 9 }), 50), true);
  assert.equal(org.skills.review.content, "v2");
  assert.equal(org.skills.review.enabled, false);
  assert.equal(org.skills.review.addedAt, 7);
  assert.deepEqual(org.skills.review.from, { user: "u1", login: "ann", name: "review", at: 50 });
  // Renamed: the copy moves under the new name and the stamp follows.
  assert.equal(followSkill(org, who, "review", skill("review", "v2"), skill("review-pr", "v2"), 60), true);
  assert.equal(org.skills.review, undefined);
  assert.equal(org.skills["review-pr"].from?.name, "review-pr");
  // A rename onto a name the org uses for something else leaves the org alone.
  org.skills.other = skill("other", "theirs");
  assert.equal(followSkill(org, who, "review-pr", skill("review-pr", "v2"), skill("other", "v2")), false);
  assert.equal(org.skills.other.content, "theirs");
  assert.ok(org.skills["review-pr"]);
  // Someone else's stamp is not this person's.
  org.skills.theirs = { ...skill("theirs", "x"), from: { user: "u2", login: "bob", name: "theirs", at: 1 } };
  assert.equal(followSkill(org, who, "theirs", skill("theirs", "x"), skill("theirs", "y")), false);
  assert.equal(org.skills.theirs.content, "x");
  // Removed at the source: the org keeps its copy, now its own.
  assert.equal(followSkill(org, who, "review-pr", skill("review-pr", "v2"), undefined), true);
  assert.equal(org.skills["review-pr"].content, "v2");
  assert.equal(org.skills["review-pr"].from, undefined);
  assert.equal(followSkill(org, who, "review-pr", skill("review-pr", "v3"), skill("review-pr", "v4")), false, "unstamped and different: not a copy any more");
});

test("followSkill: a copy made before stamps existed is claimed when it still equals the source's previous version", () => {
  const files = [{ path: "scripts/run.mjs", content: "x" }];
  const org: SkillStore = { skills: { deploy: { ...skill("deploy", "v1", { files }), addedAt: 3 }, edited: skill("edited", "org changed this") } };
  assert.equal(followSkill(org, who, "deploy", skill("deploy", "v1", { files: [{ path: "scripts/run.mjs", content: "x" }] }), skill("deploy", "v2"), 5), true);
  assert.equal(org.skills.deploy.content, "v2");
  assert.equal(org.skills.deploy.from?.user, "u1");
  assert.equal(org.skills.deploy.addedAt, 3);
  // An org entry under the same name that diverged (or was never a copy) is not touched.
  assert.equal(followSkill(org, who, "edited", skill("edited", "mine"), skill("edited", "mine v2")), false);
  assert.equal(org.skills.edited.content, "org changed this");
  assert.equal(followSkill(org, who, "nothere", skill("nothere", "a"), skill("nothere", "b")), false);
});

test("followServer: the org's copy takes the real env and headers, key order does not matter for the claim", () => {
  const srv = (name: string, token: string, extra: Partial<McpStore["servers"][string]> = {}) => ({ name, type: "http" as const, url: "https://api.example", headers: { Authorization: `Bearer ${token}`, "X-Team": "a" }, enabled: true, addedAt: 1, ...extra });
  const org: McpStore = { servers: { api: { ...srv("api", "old"), headers: { "X-Team": "a", Authorization: "Bearer old" }, enabled: false } } };
  assert.equal(followServer(org, who, "api", srv("api", "old"), srv("api", "new"), 9), true, "same content in another key order is the same copy");
  assert.equal(org.servers.api.headers?.Authorization, "Bearer new");
  assert.equal(org.servers.api.enabled, false);
  assert.deepEqual(org.servers.api.from, { user: "u1", login: "ann", name: "api", at: 9 });
  assert.equal(followServer(org, who, "api", srv("api", "new"), undefined), true);
  assert.equal(org.servers.api.from, undefined);
  assert.equal(org.servers.api.headers?.Authorization, "Bearer new", "the org keeps the server it was given");
});

test("followNote: the id is the link; text, rationale, pin and the repo it is filed under follow; recall counters stay; forgetting detaches", () => {
  const note = (over: Partial<MemoryNote>): MemoryNote => ({ id: "n1", kind: "rule", scope: "operator", status: "kept", text: "t1", at: 10, source: "box-1", ...over });
  const org = emptyMemoryStore();
  org.global.push({ ...note({ text: "t1", source: "you", at: 20, uses: 3, lastUsed: 15, from: { user: "u1", login: "ann", at: 20 } }) });
  assert.equal(followNote(org, who, "n1", note({ text: "t2", why: "because", pinned: true, uses: 99, stale: { at: 1, box: "b", paths: [] } }), 30), true);
  assert.equal(org.global.length, 1);
  assert.deepEqual(org.global[0], { id: "n1", kind: "rule", scope: "operator", status: "kept", text: "t2", why: "because", pinned: true, at: 20, source: "you", from: { user: "u1", login: "ann", at: 30 }, uses: 3, lastUsed: 15 });
  // Re-homed into a repo at the source: the org's copy moves too.
  assert.equal(followNote(org, who, "n1", note({ id: "n1", kind: "fact" as MemoryNote["kind"], scope: "repo", repo: "acme/app", text: "t2" })), true);
  assert.equal(org.global.length, 0);
  assert.equal(org.repos["acme/app"][0].text, "t2");
  // Another person's stamp, an unknown id: untouched.
  org.global.push(note({ id: "n2", from: { user: "u2", login: "bob", at: 1 } }));
  assert.equal(followNote(org, who, "n2", note({ id: "n2", text: "x" })), false);
  assert.equal(org.global[0].text, "t1");
  assert.equal(followNote(org, who, "nope", note({ id: "nope" })), false);
  // Forgotten at the source: the org keeps it, unstamped.
  assert.equal(followNote(org, who, "n1", undefined), true);
  assert.equal(org.repos["acme/app"][0].from, undefined);
  assert.equal(followNote(org, who, "n1", undefined), false);
});
