import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBoxedTable,
  parseCommands,
  parseComparison,
  parseCron,
  parseDefinitions,
  parseEnv,
  parseFileList,
  parseFixedColumns,
  parseIni,
  parseJwt,
  parseLinks,
  parseMermaidFlow,
  parseSemver,
  parseStackTrace,
  parseStatusItems,
  parseUrl,
  parseYamlLite,
  sniffBare,
  sniffLanguage,
} from "../web/src/lib/viz-auto.ts";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", iat: 1_790_680_000, exp: 1_790_683_600 })}.sig_sig_sig_sig`;

test("env: KEY=value lines, secrets masked by key or by shape, comments kept", () => {
  const vars = parseEnv("# staging\nDATABASE_URL=postgres://app:pw@db/app\nexport LOG_LEVEL=info # verbose in dev\nAPI_KEY=example-key-not-real-9f8e7d6c5b4a\n");
  assert.ok(vars);
  assert.deepEqual(vars.map((v) => [v.key, v.secret]), [["DATABASE_URL", true], ["LOG_LEVEL", false], ["API_KEY", true]]);
  assert.equal(vars[0].comment, "staging");
  assert.equal(vars[1].comment, "verbose in dev");
  assert.equal(parseEnv("just a sentence\nanother one"), null);
  assert.equal(parseEnv("A=1"), null); // one var is not a listing
});

test("stack trace: node frames, vendor folding, message first", () => {
  const t = parseStackTrace("TypeError: x is not a function\n    at getOwner (src/auth.ts:41:19)\n    at Layer.handle (node_modules/express/lib/router/layer.js:95:5)\n    at async login (src/routes/login.ts:12:5)");
  assert.ok(t);
  assert.equal(t.language, "js");
  assert.equal(t.name, "TypeError");
  assert.deepEqual(t.frames.map((f) => [f.fn, f.line, f.vendor]), [["getOwner", 41, false], ["Layer.handle", 95, true], ["async login", 12, false]]);
});

test("stack trace: python puts the exception last", () => {
  const t = parseStackTrace('Traceback (most recent call last):\n  File "app.py", line 12, in <module>\n    main()\n  File "app.py", line 8, in main\n    1/0\nZeroDivisionError: division by zero');
  assert.ok(t);
  assert.equal(t.language, "py");
  assert.equal(t.message, "ZeroDivisionError: division by zero");
  assert.equal(t.frames.length, 2);
  assert.equal(parseStackTrace("INFO started\nINFO listening on 8080"), null);
});

test("fixed columns: docker ps style header + rows", () => {
  const c = parseFixedColumns("CONTAINER ID   IMAGE            STATUS       NAMES\n3f2a1b9c8d7e   acme/api:1.4.1   Up 2 hours   api\n9e8d7c6b5a4f   postgres:16      Up 2 hours   db");
  assert.ok(c);
  assert.deepEqual(c.head, ["CONTAINER ID", "IMAGE", "STATUS", "NAMES"]);
  assert.deepEqual(c.rows[1], ["9e8d7c6b5a4f", "postgres:16", "Up 2 hours", "db"]);
  assert.equal(parseFixedColumns("This is a sentence with  two spaces\nand another line here"), null);
});

test("boxed table: psql grid with row count footer", () => {
  const c = parseBoxedTable(" id | login | plan\n----+-------+------\n  1 | ak    | trial\n  2 | priya | pro\n(2 rows)");
  assert.ok(c);
  assert.deepEqual(c.head, ["id", "login", "plan"]);
  assert.deepEqual(c.rows, [["1", "ak", "trial"], ["2", "priya", "pro"]]);
  assert.ok(parseBoxedTable("+----+------+\n| id | name |\n+----+------+\n| 1  | ak   |\n+----+------+"));
});

test("yaml-lite: nested maps, lists, inline arrays, scalars", () => {
  const v = parseYamlLite("server:\n  port: 8080\n  cors:\n    origins: [a, b]\ndatabase:\n  ssl: true\nfeatures:\n  - billing\n  - audit-log\n") as Record<string, unknown>;
  assert.deepEqual(v, { server: { port: 8080, cors: { origins: ["a", "b"] } }, database: { ssl: true }, features: ["billing", "audit-log"] });
  assert.equal(parseYamlLite("a: &x 1\nb: *x"), null);
  assert.equal(parseYamlLite("a: 1\nb: 2"), null); // flat + tiny → kv, not a JSON explorer
});

test("ini/toml sections", () => {
  const s = parseIni("[server]\nport = 8080\n; comment\n[database]\npool = 10\nssl = true");
  assert.ok(s);
  assert.deepEqual(s.map((x) => [x.name, x.rows.length]), [["server", 1], ["database", 2]]);
  assert.equal(parseIni("port = 8080\nhost = x"), null); // no section → not ini
});

test("file list: ls -l with dirs, links and sizes", () => {
  const f = parseFileList("total 48\ndrwxr-xr-x  6 app app 4096 Sep 29 08:10 src\n-rw-r--r--  1 app app 1834 Sep 29 08:10 package.json\nlrwxrwxrwx  1 app app   11 Sep 29 08:10 current -> releases/12");
  assert.ok(f);
  assert.deepEqual(f.map((e) => [e.name, e.kind, e.bytes]), [["src", "dir", 4096], ["package.json", "file", 1834], ["current -> releases/12", "link", 11]]);
  const du = parseFileList("4.0K\t./test\n12M\t./node_modules\n92K\t./src");
  assert.ok(du);
  assert.equal(du[1].bytes, 12 * 1024 * 1024);
});

test("links: classified GitHub links and docs", () => {
  const l = parseLinks("- https://github.com/acme/web/pull/482\n- Issue: https://github.com/acme/api/issues/917\n- [Guide](https://docs.example.com/guides/rate-limits)");
  assert.ok(l);
  assert.deepEqual(l.map((x) => [x.kind, x.ref ?? x.label]), [["pr", "acme/web#482"], ["issue", "acme/api#917"], ["doc", "Guide"]]);
  assert.equal(parseLinks("https://a.com\nnot a link"), null);
});

test("commands: $ prompts with comments, and plain command fences", () => {
  const c = parseCommands("# install\n$ npm ci\n$ npm test\nadded 12 packages");
  assert.ok(c);
  assert.deepEqual(c.map((x) => [x.cmd, x.comment]), [["npm ci", "install"], ["npm test", undefined]]);
  assert.ok(parseCommands("git checkout -b fix\ngit push -u origin fix"));
  assert.equal(parseCommands("hello world\nsecond line"), null);
});

test("comparison: before → after with units and direction", () => {
  const r = parseComparison("p95 latency: 210ms → 118ms\nRequests/s: 1,240 -> 1,910\nError rate: 0.8% => 0.1%");
  assert.ok(r);
  assert.deepEqual(r.map((x) => [x.beforeNum, x.afterNum, x.unit, x.betterWhen]), [[210, 118, "ms", "lower"], [1240, 1910, undefined, "higher"], [0.8, 0.1, "%", "lower"]]);
  assert.equal(parseComparison("we moved from A → B in the design"), null);
});

test("cron: descriptions and aliases", () => {
  const c = parseCron("30 2 * * *   /usr/local/bin/backup.sh\n*/15 * * * * curl health\n0 9 * * 1-5 digest\n@daily cleanup");
  assert.ok(c);
  assert.equal(c[0].description, "Every day at 02:30 — /usr/local/bin/backup.sh");
  assert.equal(c[1].description, "Every 15 minutes — curl health");
  assert.equal(c[2].description, "At 09:00 on Monday–Friday — digest");
  assert.equal(c[3].expr, "@daily");
  assert.equal(parseCron("30 2 * *"), null);
});

test("url and jwt", () => {
  const u = parseUrl("https://hooks.example.com/v1/deliver?channel=ops&retry=3#latest");
  assert.ok(u);
  assert.deepEqual([u.host, u.path, u.query, u.hash], ["hooks.example.com", "/v1/deliver", [{ key: "channel", value: "ops" }, { key: "retry", value: "3" }], "latest"]);
  const j = parseJwt(JWT, 1_790_682_000_000);
  assert.ok(j);
  assert.deepEqual([j.header.alg, j.payload.sub, j.expired], ["HS256", "u1", false]);
  assert.equal(parseJwt(JWT, 1_790_690_000_000)!.expired, true);
  assert.equal(parseJwt("abc.def.ghi"), null);
});

test("semver rows and npm outdated tables", () => {
  const r = parseSemver("react 18.3.1 → 19.0.0\nzod: 3.23.8 -> 3.23.9\nvite@5.4.2 → vite@6.0.1");
  assert.ok(r);
  assert.deepEqual(r.map((x) => x.jump), ["major", "patch", "major"]);
  const o = parseSemver("Package  Current  Wanted  Latest  Location\nreact    18.3.1   18.3.1  19.0.0  node_modules/react");
  assert.ok(o);
  assert.deepEqual([o[0].name, o[0].to, o[0].jump], ["react", "19.0.0", "major"]);
});

test("mermaid flowchart edges use node labels", () => {
  const e = parseMermaidFlow("graph LR\n  A[Checkout] --> B[Install]\n  B --> C{Test}\n  C -->|ok| D(Deploy)");
  assert.deepEqual(e, [["Checkout", "Install"], ["Install", "Test"], ["Test", "Deploy"]]);
  assert.equal(parseMermaidFlow("sequenceDiagram\n  A->>B: hi"), null);
});

test("list items: definitions and status glyphs", () => {
  const d = parseDefinitions(["**Warm pool** — booted sandboxes waiting", "Sleep: a stopped microVM", "Keep - a pinned sandbox"]);
  assert.ok(d);
  assert.deepEqual(d.map((x) => x.term), ["Warm pool", "Sleep", "Keep"]);
  assert.equal(parseDefinitions(["one", "two", "three"]), null);
  const s = parseStatusItems(["✅ Unit tests", "❌ e2e: login flow", "⏳ Lighthouse", "⚠️ 2 warnings", "PASS lint"]);
  assert.ok(s);
  assert.deepEqual(s.map((x) => x.state), ["ok", "fail", "pending", "warn", "ok"]);
  assert.equal(parseStatusItems(["✅ ok", "plain item"]), null);
});

test("sniffBare keeps look-alikes apart", () => {
  assert.equal(sniffBare("DATABASE_URL=x\nAPI_KEY=y\nPORT=3")?.kind, "env");
  assert.equal(sniffBare("name: ak\nplan: trial\nboxes: 3")?.kind, "kv");
  assert.equal(sniffBare("TypeError: boom\n    at a (src/a.ts:1:1)\n    at b (src/b.ts:2:2)")?.kind, "stack");
  assert.equal(sniffBare("2026-09-29 08:10:01 INFO started\n2026-09-29 08:10:02 WARN slow\n2026-09-29 08:10:03 ERROR boom")?.kind, "log");
  assert.equal(sniffBare("NAME   STATUS   AGE\napi    Running  2h\ndb     Running  2h")?.kind, "table");
  assert.equal(sniffBare("id,name,plan\n1,ak,trial\n2,priya,pro")?.kind, "csv");
  assert.equal(sniffBare(" id | name\n----+-----\n  1 | ak\n(1 row)")?.kind, "table");
  assert.equal(sniffBare("$ npm ci\n$ npm test")?.kind, "commands");
  assert.equal(sniffBare("p95: 210ms → 118ms\nsize: 887 kB → 612 kB")?.kind, "comparison");
  assert.equal(sniffBare("30 2 * * * backup")?.kind, "cron");
  assert.equal(sniffBare("react 18.3.1 → 19.0.0\nvite 5.4.2 → 6.0.1")?.kind, "semver");
  assert.equal(sniffBare("- https://github.com/a/b/pull/1\n- https://github.com/a/b/pull/2")?.kind, "links");
  assert.equal(sniffBare("build -> test\ntest -> deploy")?.kind, "dag");
  assert.equal(sniffBare(JWT)?.kind, "jwt");
  assert.equal(sniffBare("https://example.com/a?b=1")?.kind, "url");
  assert.equal(sniffBare("server:\n  port: 8080\n  host: x\ndb:\n  pool: 3")?.kind, "json");
  // Prose and code stay code.
  assert.equal(sniffBare("This is just a paragraph of text that the agent wrote.\nIt has two lines."), null);
  assert.equal(sniffBare("function a() {\n  return 1;\n}"), null);
  assert.equal(sniffBare("const x = 1;\nlet y = 2;"), null);
});

test("sniffLanguage routes yaml / ini / env / mermaid / console", () => {
  assert.equal(sniffLanguage("yaml", "a:\n  b: 1\n  c: 2")?.kind, "json");
  assert.equal(sniffLanguage("toml", "[server]\nport = 1")?.kind, "ini");
  assert.equal(sniffLanguage("env", "A=1\nB=2")?.kind, "env");
  assert.equal(sniffLanguage("mermaid", "graph TD\nA-->B")?.kind, "dag");
  assert.equal(sniffLanguage("bash", "$ npm ci")?.kind, "commands");
  assert.equal(sniffLanguage("bash", "npm ci"), null); // a script without prompts stays code
  assert.equal(sniffLanguage("ts", "const a = 1"), null);
});
