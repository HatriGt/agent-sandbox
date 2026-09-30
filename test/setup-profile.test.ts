import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSetup,
  parseProbe,
  parseSentinel,
  sanitizeProfile,
  setupPromptHint,
  workflowRunCommands,
  SETUP_SENTINEL,
  type ProbeFiles,
} from "../src/setup-profile.js";
import { openMemoryDb } from "../src/db.js";
import { deleteSetup, getSetup, listSetups, recordLearned, repoSlugFromUrl, saveSetup } from "../src/setup-store.js";
import { reposPromptHint } from "../src/agent-prompt.js";
import { buildOutcome } from "../src/outcome.js";
import { runVerification } from "../src/verify.js";

const probe = (files: Record<string, string>, locks: string[] = []): ProbeFiles => ({ files, locks: new Set(locks) });

test("node: lockfile picks the package manager; scripts become commands", () => {
  const pkg = JSON.stringify({ scripts: { test: "vitest run", build: "tsc", lint: "eslint ." }, engines: { node: ">=20" } });
  const npm = detectSetup(probe({ "package.json": pkg }, ["package-lock.json"]))!;
  assert.equal(npm.install, "npm ci");
  assert.equal(npm.test, "npm test");
  assert.equal(npm.build, "npm run build");
  assert.equal(npm.lint, "npm run lint");
  assert.equal(npm.runtimes.node, ">=20");
  assert.equal(npm.confirmedBy, "detected");
  const pnpm = detectSetup(probe({ "package.json": pkg }, ["pnpm-lock.yaml"]))!;
  assert.equal(pnpm.install, "pnpm install --frozen-lockfile");
  assert.equal(pnpm.test, "pnpm test");
  assert.equal(detectSetup(probe({ "package.json": pkg }, ["yarn.lock"]))!.install, "yarn install --frozen-lockfile");
  assert.equal(detectSetup(probe({ "package.json": pkg }, ["bun.lockb"]))!.test, "bun run test");
});

test("node: the npm init placeholder test script is not a test command", () => {
  const p = detectSetup(probe({ "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }))!;
  assert.equal(p.test, undefined);
  assert.equal(p.install, "npm install");
});

test("python: uv / poetry / pip + pytest", () => {
  const py = `[project]\nrequires-python = ">=3.11"\n[tool.pytest.ini_options]\n[tool.ruff]\n`;
  const uv = detectSetup(probe({ "pyproject.toml": py }, ["uv.lock"]))!;
  assert.equal(uv.install, "uv sync");
  assert.equal(uv.test, "uv run pytest");
  assert.equal(uv.lint, "uv run ruff check .");
  assert.equal(uv.runtimes.python, ">=3.11");
  assert.equal(detectSetup(probe({ "pyproject.toml": "[tool.poetry]\npytest = '*'" }, ["poetry.lock"]))!.test, "poetry run pytest");
  const pip = detectSetup(probe({ "requirements.txt": "flask\npytest==8\n" }))!;
  assert.equal(pip.install, "pip install -r requirements.txt");
  assert.equal(pip.test, "pytest");
});

test("go, cargo, Makefile precedence, tool versions", () => {
  const go = detectSetup(probe({ "go.mod": "module x\n\ngo 1.22\n" }))!;
  assert.equal(go.test, "go test ./...");
  assert.equal(go.runtimes.go, "1.22");
  assert.equal(detectSetup(probe({ "Cargo.toml": "[package]" }))!.test, "cargo test");
  const mk = detectSetup(probe({ "go.mod": "go 1.21", Makefile: "test:\n\tgo test -race ./...\nlint:\n\tgolangci-lint run\nVAR := 1\n" }))!;
  assert.equal(mk.test, "make test");
  assert.equal(mk.lint, "make lint");
  assert.equal(mk.build, "go build ./...");
  const tv = detectSetup(probe({ "package.json": "{}", ".tool-versions": "nodejs 20.11.0\npython 3.12.1\n", ".nvmrc": "v18\n" }))!;
  assert.equal(tv.runtimes.node, "18");
  assert.equal(tv.runtimes.python, "3.12.1");
});

test("CI workflow run steps are the strongest hint; secrets become env NAMES", () => {
  const wf = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 20",
    "      - run: npm ci --ignore-scripts",
    "      - name: tests",
    "        run: |",
    "          npm run test:unit",
    "          npm test -- --coverage",
    "        env:",
    "          API_KEY: ${{ secrets.STRIPE_KEY }}",
    "      - run: echo ${{ github.sha }}",
  ].join("\n");
  assert.deepEqual(workflowRunCommands(wf), ["npm ci --ignore-scripts", "npm run test:unit", "npm test -- --coverage", "echo ${{ github.sha }}"]);
  const p = detectSetup(probe({ "package.json": JSON.stringify({ scripts: { test: "jest" } }), ".github/workflows/ci.yml": wf }, ["package-lock.json"]))!;
  assert.equal(p.install, "npm ci --ignore-scripts");
  assert.equal(p.test, "npm run test:unit", "the first test step CI runs");
  assert.equal(p.runtimes.node, "20");
  assert.deepEqual(p.envVars, ["STRIPE_KEY"]);
  assert.match(p.notes!, /\.github\/workflows\/ci\.yml/);
});

test(".env.example contributes names only, never values", () => {
  const p = detectSetup(probe({ "package.json": "{}", ".env.example": "DATABASE_URL=postgres://u:hunter2secret@db/x\n# c\nexport REDIS_URL=\n" }))!;
  assert.deepEqual(p.envVars, ["DATABASE_URL", "REDIS_URL"]);
  assert.doesNotMatch(JSON.stringify(p), /hunter2/);
});

test("nothing recognisable → null", () => {
  assert.equal(detectSetup(probe({ "README.md": "hi" })), null);
});

test("parseProbe splits file blocks and lockfile markers", () => {
  const p = parseProbe("@@F package.json\n{\"a\":1}\n\n@@L package-lock.json\n@@F .github/workflows/ci.yml\nrun: x\n");
  assert.equal(p.files["package.json"].trim(), '{"a":1}');
  assert.ok(p.locks.has("package-lock.json"));
  assert.equal(p.files[".github/workflows/ci.yml"].trim(), "run: x");
});

test("sanitize: redacts secret shapes, keeps env names only, bounds fields", () => {
  const p = sanitizeProfile(
    { test: "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456 npm test", envVars: ["FOO=bar-secret-value", "$BAR", "not a name!", 7], runtimes: { node: "20", "bad key!": "1", py: "$(rm -rf)" }, notes: "token sk-ant-abcdefghijklmnopqrstuvwxyz" },
    "agent"
  );
  assert.doesNotMatch(JSON.stringify(p), /ghp_abcdefghij|bar-secret|sk-ant-abcdefghij/);
  assert.deepEqual(p.envVars, ["FOO", "BAR"]);
  assert.deepEqual(p.runtimes, { node: "20" });
  assert.equal(p.confirmedBy, "agent");
});

test("sentinel: keyed by dir name, or the bare profile for a single repo", () => {
  assert.equal(parseSentinel('{"test":"npm test"}', ["app"]).app.test, "npm test");
  assert.deepEqual(parseSentinel('{"test":"npm test"}', ["a", "b"]), {});
  const m = parseSentinel('{"a":{"test":"pytest"},"zzz":{"test":"x"}}', ["a", "b"]);
  assert.deepEqual(Object.keys(m), ["a"]);
  assert.deepEqual(parseSentinel("not json", ["a"]), {});
});

test("store: detection fills, agent refines, user edits are never overwritten, reset", () => {
  const db = openMemoryDb();
  const det = detectSetup(probe({ "package.json": JSON.stringify({ scripts: { test: "jest", build: "tsc" } }) }, ["package-lock.json"]))!;
  assert.ok(recordLearned(db, "u1", "Acme/App", { detected: det }));
  assert.equal(recordLearned(db, "u1", "acme/app", { detected: det }), undefined, "detection never replaces a stored profile");
  const agent = sanitizeProfile({ test: "npm run test:ci", envVars: ["API_URL"] }, "agent");
  const merged = recordLearned(db, "u1", "acme/app", { agent })!;
  assert.equal(merged.test, "npm run test:ci");
  assert.equal(merged.build, "npm run build");
  assert.equal(merged.confirmedBy, "agent");
  saveSetup(db, "u1", "acme/app", { test: "make test" }, "user");
  assert.equal(recordLearned(db, "u1", "acme/app", { agent }), undefined);
  assert.equal(getSetup(db, "u1", "acme/app")!.test, "make test");
  assert.equal(getSetup(db, "u2", "acme/app"), undefined, "per user");
  assert.equal(listSetups(db, "u1").length, 1);
  assert.ok(deleteSetup(db, "u1", "ACME/app"));
  assert.equal(getSetup(db, "u1", "acme/app"), undefined);
});

test("repoSlugFromUrl", () => {
  assert.equal(repoSlugFromUrl("https://x-access-token:abc@github.com/Acme/App.git"), "acme/app");
  assert.equal(repoSlugFromUrl("git@github.com:acme/app"), "acme/app");
  assert.equal(repoSlugFromUrl("https://gitlab.com/a/b"), undefined);
});

test("prompt hint: states the commands, the install result and the sentinel", () => {
  const p = sanitizeProfile({ install: "npm ci", test: "npm test", envVars: ["API_URL"] }, "agent");
  const h = setupPromptHint("app", p, { installed: "ok" });
  assert.match(h, /already installed with `npm ci`/);
  assert.match(h, /test: `npm test`/);
  assert.match(h, /API_URL/);
  assert.ok(h.includes(SETUP_SENTINEL));
  const full = reposPromptHint([{ name: "app", setupHint: h }]);
  assert.match(full, /^The repository is checked out at \/workspace\/app\. Setup for/);
});

test("outcome: Tested with the verify command, with its counts", async () => {
  const v = await runVerification(
    { mode: "command", command: "npm test" },
    { execCommand: async () => ({ code: 0, output: "ℹ tests 3\nℹ pass 3\nℹ fail 0\n" }), askCriterion: async () => ({ answer: "" }) }
  );
  assert.equal(v.command, "npm test");
  const o = buildOutcome({ digest: { box: "b", task: "t", state: "done", headline: "", files: [], questions: [], verified: v } as never });
  assert.equal(o.trust.testedWith, "npm test");
  assert.equal(o.trust.tests?.passed, 3);
});
