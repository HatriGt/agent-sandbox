/**
 * "Learns each repo's setup once": a per user × repo SETUP PROFILE — how the repo installs, builds,
 * tests and lints, which runtime versions it wants and which env var NAMES it expects.
 *
 * Lifecycle:
 *  1. First run on a repo with no profile: `detectSetup` reads the repo's own files (package.json +
 *     lockfile, pyproject/requirements, go.mod, Cargo.toml, Makefile, .tool-versions/.nvmrc, and —
 *     the strongest hint — the `run:` steps of .github/workflows) and the result is saved as
 *     confirmedBy "detected". The agent is shown it and asked to correct it by writing
 *     SETUP_SENTINEL, which the controller reads at the finish edge (confirmedBy "agent").
 *  2. Later runs: install runs in the box before the agent starts, the commands go into the system
 *     prompt, and the test command becomes the default verify command (real test counts on the
 *     outcome card).
 *  3. The user can edit (confirmedBy "user" — never overwritten by the agent) or reset it.
 *
 * NEVER a secret: env vars are stored by NAME only, and every free-text field is redacted by shape.
 * Everything here is pure; the box IO lives in deps.ts / http.ts, the rows in setup-store.ts.
 */
import { redactShapes } from "./redact.js";

export type SetupConfirmedBy = "detected" | "agent" | "user";

export interface SetupProfile {
  v: 1;
  install?: string;
  build?: string;
  test?: string;
  lint?: string;
  /** Tool → version ("node" → "20", "python" → "3.12"). */
  runtimes: Record<string, string>;
  /** Env var NAMES the repo needs. Values are never stored. */
  envVars: string[];
  notes?: string;
  detectedAt: number;
  confirmedBy: SetupConfirmedBy;
}

/** Where the agent writes its corrections: outside every repo dir, so it never lands in a diff. */
export const SETUP_SENTINEL = "/workspace/.asb/setup.json";

const CMD_MAX = 500;
const NOTES_MAX = 1000;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RT_KEY_RE = /^[\w.+-]{1,32}$/;
const RT_VAL_RE = /^[\w.+~^<>=*-]{1,40}$/;
const CMD_KEYS = ["install", "build", "test", "lint"] as const;
type CmdKey = (typeof CMD_KEYS)[number];

// ---------------------------------------------------------------------------------------------------
// Sanitizing (every write path: detection, agent sentinel, user edit)

function cleanCmd(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\r/g, "").trim();
  if (!s) return undefined;
  return redactShapes(s).slice(0, CMD_MAX);
}

/** Accept `FOO`, `FOO=bar` (keeps only the name) or `$FOO`; drop anything else. */
export function envNameOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.trim().match(/^\$?\{?([A-Za-z_][A-Za-z0-9_]*)\}?(?:=[\s\S]*)?$/);
  return m && ENV_RE.test(m[1]) ? m[1] : undefined;
}

export function sanitizeProfile(input: unknown, confirmedBy: SetupConfirmedBy, now = Date.now()): SetupProfile {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const p: SetupProfile = { v: 1, runtimes: {}, envVars: [], detectedAt: typeof o.detectedAt === "number" && o.detectedAt > 0 ? o.detectedAt : now, confirmedBy };
  for (const k of CMD_KEYS) {
    const c = cleanCmd(o[k]);
    if (c) p[k] = c;
  }
  if (o.runtimes && typeof o.runtimes === "object" && !Array.isArray(o.runtimes)) {
    for (const [k, v] of Object.entries(o.runtimes as Record<string, unknown>).slice(0, 20)) {
      const val = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
      if (RT_KEY_RE.test(k) && RT_VAL_RE.test(val)) p.runtimes[k] = val;
    }
  }
  if (Array.isArray(o.envVars)) {
    p.envVars = [...new Set(o.envVars.map(envNameOf).filter((x): x is string => !!x))].slice(0, 50);
  }
  if (typeof o.notes === "string" && o.notes.trim()) p.notes = redactShapes(o.notes.trim()).slice(0, NOTES_MAX);
  return p;
}

/** Agent refinement over a base: fields the agent set win, absent ones keep the base's. */
export function mergeProfile(base: SetupProfile | undefined, over: SetupProfile): SetupProfile {
  if (!base) return over;
  const out: SetupProfile = { ...base, confirmedBy: over.confirmedBy, detectedAt: base.detectedAt };
  for (const k of CMD_KEYS) if (over[k]) out[k] = over[k];
  out.runtimes = { ...base.runtimes, ...over.runtimes };
  out.envVars = [...new Set([...base.envVars, ...over.envVars])].slice(0, 50);
  if (over.notes) out.notes = over.notes;
  return out;
}

export function isEmptyProfile(p: SetupProfile): boolean {
  return !CMD_KEYS.some((k) => p[k]) && !Object.keys(p.runtimes).length && !p.envVars.length;
}

// ---------------------------------------------------------------------------------------------------
// Detection

/** Files detection reads (relative to the repo root). Lockfiles are presence-only. */
export const PROBE_FILES = [
  "package.json", "pyproject.toml", "requirements.txt", "requirements-dev.txt", "Pipfile", "go.mod", "Cargo.toml",
  "Makefile", ".tool-versions", ".nvmrc", ".node-version", ".python-version", "rust-toolchain", "rust-toolchain.toml",
  ".env.example", ".env.sample", ".env.template",
];
export const PROBE_LOCKS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "Cargo.lock"];

/**
 * Shell that dumps the probe files of `dir` as `@@F <path>` blocks (content capped), lockfiles as
 * `@@L <name>`, and every workflow file under .github/workflows. Read-only.
 */
export function setupProbeSh(dir: string): string {
  const q = `'${dir.replace(/'/g, `'\\''`)}'`;
  return (
    `cd ${q} 2>/dev/null || exit 0; ` +
    `for f in ${PROBE_FILES.join(" ")}; do [ -f "$f" ] && { echo "@@F $f"; head -c 20000 "$f"; echo; }; done; ` +
    `for f in ${PROBE_LOCKS.join(" ")}; do [ -e "$f" ] && echo "@@L $f"; done; ` +
    `for f in .github/workflows/*.yml .github/workflows/*.yaml; do [ -f "$f" ] && { echo "@@F $f"; head -c 30000 "$f"; echo; }; done; true`
  );
}

export interface ProbeFiles {
  files: Record<string, string>;
  locks: Set<string>;
}

export function parseProbe(stdout: string): ProbeFiles {
  const files: Record<string, string> = {};
  const locks = new Set<string>();
  let cur: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur !== null) files[cur] = buf.join("\n");
    cur = null;
    buf = [];
  };
  for (const line of stdout.split("\n")) {
    const f = line.match(/^@@F (\S.*)$/);
    const l = line.match(/^@@L (\S.*)$/);
    if (f) {
      flush();
      cur = f[1].trim();
    } else if (l) {
      flush();
      locks.add(l[1].trim());
    } else if (cur !== null) buf.push(line);
  }
  flush();
  return { files, locks };
}

type Pm = "npm" | "pnpm" | "yarn" | "bun";

function nodeSetup(pkgText: string, locks: Set<string>): { cmds: Partial<Record<CmdKey, string>>; node?: string; pm: Pm } | null {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(pkgText) as Record<string, unknown>;
  } catch {
    return null;
  }
  const declared = typeof pkg.packageManager === "string" ? (pkg.packageManager.split("@")[0] as string) : "";
  const pm: Pm =
    declared === "pnpm" || declared === "yarn" || declared === "bun" || declared === "npm"
      ? (declared as Pm)
      : locks.has("pnpm-lock.yaml") ? "pnpm" : locks.has("yarn.lock") ? "yarn" : locks.has("bun.lockb") || locks.has("bun.lock") ? "bun" : "npm";
  const install =
    pm === "pnpm" ? (locks.has("pnpm-lock.yaml") ? "pnpm install --frozen-lockfile" : "pnpm install")
    : pm === "yarn" ? (locks.has("yarn.lock") ? "yarn install --frozen-lockfile" : "yarn install")
    : pm === "bun" ? "bun install"
    : locks.has("package-lock.json") ? "npm ci" : "npm install";
  const scripts = (pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {}) as Record<string, unknown>;
  const has = (s: string) => typeof scripts[s] === "string" && !/no test specified/.test(scripts[s] as string);
  const run = (s: string) => (s === "test" && pm !== "bun" ? `${pm} test` : pm === "npm" || pm === "bun" ? `${pm} run ${s}` : `${pm} ${s}`);
  const cmds: Partial<Record<CmdKey, string>> = { install };
  if (has("build")) cmds.build = run("build");
  if (has("test")) cmds.test = run("test");
  const lint = ["lint", "typecheck", "check"].find(has);
  if (lint) cmds.lint = run(lint);
  const engines = (pkg.engines && typeof pkg.engines === "object" ? pkg.engines : {}) as Record<string, unknown>;
  const node = typeof engines.node === "string" ? engines.node.replace(/\s+/g, "") : undefined;
  return { cmds, pm, ...(node ? { node } : {}) };
}

function pythonSetup(f: Record<string, string>, locks: Set<string>): { cmds: Partial<Record<CmdKey, string>>; python?: string } | null {
  const py = f["pyproject.toml"];
  const req = f["requirements.txt"];
  if (py === undefined && req === undefined && f["Pipfile"] === undefined) return null;
  const all = [py, req, f["requirements-dev.txt"], f["Pipfile"]].filter(Boolean).join("\n");
  let install: string;
  let prefix = "";
  if (locks.has("uv.lock") || /\[tool\.uv\]/.test(py ?? "")) {
    install = "uv sync";
    prefix = "uv run ";
  } else if (locks.has("poetry.lock") || /\[tool\.poetry\]/.test(py ?? "")) {
    install = "poetry install";
    prefix = "poetry run ";
  } else if (f["Pipfile"] !== undefined) {
    install = "pipenv install --dev";
    prefix = "pipenv run ";
  } else if (req !== undefined) {
    install = `pip install -r requirements.txt${f["requirements-dev.txt"] !== undefined ? " -r requirements-dev.txt" : ""}`;
  } else install = "pip install -e .";
  const cmds: Partial<Record<CmdKey, string>> = { install };
  if (/\bpytest\b/i.test(all)) cmds.test = `${prefix}pytest`;
  if (/\bruff\b/i.test(all)) cmds.lint = `${prefix}ruff check .`;
  else if (/\bflake8\b/i.test(all)) cmds.lint = `${prefix}flake8`;
  const rp = (py ?? "").match(/requires-python\s*=\s*["']([^"']+)["']/);
  const python = f[".python-version"]?.trim().split("\n")[0] || rp?.[1]?.replace(/\s+/g, "");
  return { cmds, ...(python ? { python } : {}) };
}

function makeTargets(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/^([A-Za-z][\w-]*)\s*:(?!=)/gm)) out.add(m[1]);
  return out;
}

/** Every command in the workflows' `run:` steps (single-line and `|` / `>` blocks), in order. */
export function workflowRunCommands(yaml: string): string[] {
  const lines = yaml.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const rest = m[2].trim();
    if (rest && !/^[|>][-+]?$/.test(rest)) {
      out.push(rest.replace(/^["']|["']$/g, ""));
      continue;
    }
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      if (l.length - l.trimStart().length <= indent) break;
      const c = l.trim();
      if (!c.startsWith("#")) out.push(c);
      i = j;
    }
  }
  return out;
}

const CI_CLASS: Array<[CmdKey, RegExp]> = [
  ["install", /^(?:npm (?:ci|install|i)\b|pnpm (?:install|i)\b|yarn(?: install)?\s*(?:--|$)|bun install|pip3? install|python3? -m pip install|poetry install|uv sync|pipenv install|go mod download|bundle install|cargo fetch)/],
  ["test", /^(?:(?:npm|pnpm|yarn|bun)(?: run)? test\b|(?:uv run |poetry run |pipenv run |python3? -m )?pytest\b|go test\b|cargo test\b|make test\b|npx (?:jest|vitest)\b|(?:bundle exec )?rspec\b|tox\b)/],
  ["lint", /^(?:(?:npm|pnpm|yarn|bun)(?: run)? (?:lint|typecheck|check)\b|(?:uv run |poetry run )?(?:ruff|flake8|mypy)\b|go vet\b|golangci-lint\b|cargo clippy\b|make lint\b|npx (?:eslint|tsc)\b)/],
  ["build", /^(?:(?:npm|pnpm|yarn|bun)(?: run)? build\b|go build\b|cargo build\b|make(?: build)?\s*$|make build\b)/],
];

function ciSetup(workflows: string[]): { cmds: Partial<Record<CmdKey, string>>; runtimes: Record<string, string>; env: string[]; sources: string[] } {
  const cmds: Partial<Record<CmdKey, string>> = {};
  const runtimes: Record<string, string> = {};
  const env = new Set<string>();
  for (const y of workflows) {
    for (const raw of workflowRunCommands(y)) {
      // Expressions (${{ … }}) are CI-only plumbing, not something a box can run as-is.
      if (/\$\{\{/.test(raw)) continue;
      for (const [k, re] of CI_CLASS) {
        if (!cmds[k] && re.test(raw)) {
          cmds[k] = raw;
          break;
        }
      }
    }
    for (const m of y.matchAll(/\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) if (m[1] !== "GITHUB_TOKEN") env.add(m[1]);
    const ver = (key: string) => (y.match(new RegExp(`${key}:\\s*["']?([\\w.+~^<>=*-]+)["']?`)) ?? [])[1];
    const node = ver("node-version");
    const python = ver("python-version");
    const go = ver("go-version");
    if (node && !node.startsWith("$")) runtimes.node ??= node;
    if (python && !python.startsWith("$")) runtimes.python ??= python;
    if (go && !go.startsWith("$")) runtimes.go ??= go;
  }
  return { cmds, runtimes, env: [...env], sources: [] };
}

function envExampleNames(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Deterministic setup from the repo's files. Precedence per command: CI workflow step > Makefile
 * target > language manifest. Returns null when nothing recognisable is present.
 */
export function detectSetup(probe: ProbeFiles, now = Date.now()): SetupProfile | null {
  const f = probe.files;
  const cmds: Partial<Record<CmdKey, string>> = {};
  const runtimes: Record<string, string> = {};
  const env = new Set<string>();
  const sources: string[] = [];
  const fill = (c: Partial<Record<CmdKey, string>>, override: boolean) => {
    for (const k of CMD_KEYS) if (c[k] && (override || !cmds[k])) cmds[k] = c[k];
  };

  // Language manifests (weakest).
  if (f["package.json"] !== undefined) {
    const n = nodeSetup(f["package.json"], probe.locks);
    if (n) {
      fill(n.cmds, false);
      if (n.node) runtimes.node = n.node;
      sources.push("package.json");
    }
  }
  const p = pythonSetup(f, probe.locks);
  if (p) {
    fill(p.cmds, false);
    if (p.python) runtimes.python = p.python;
    sources.push(f["pyproject.toml"] !== undefined ? "pyproject.toml" : "requirements.txt");
  }
  if (f["go.mod"] !== undefined) {
    fill({ install: "go mod download", build: "go build ./...", test: "go test ./...", lint: "go vet ./..." }, false);
    const gv = f["go.mod"].match(/^go\s+([\d.]+)/m);
    if (gv) runtimes.go = gv[1];
    sources.push("go.mod");
  }
  if (f["Cargo.toml"] !== undefined) {
    fill({ install: "cargo fetch", build: "cargo build", test: "cargo test", lint: "cargo clippy" }, false);
    const rv = (f["rust-toolchain.toml"] ?? "").match(/channel\s*=\s*["']([^"']+)["']/)?.[1] ?? f["rust-toolchain"]?.trim().split("\n")[0];
    if (rv) runtimes.rust = rv;
    sources.push("Cargo.toml");
  }
  // Makefile targets: the repo's own entry points beat language defaults.
  if (f["Makefile"] !== undefined) {
    const t = makeTargets(f["Makefile"]);
    const mk: Partial<Record<CmdKey, string>> = {};
    if (t.has("install") || t.has("deps") || t.has("setup")) mk.install = `make ${t.has("install") ? "install" : t.has("deps") ? "deps" : "setup"}`;
    if (t.has("build")) mk.build = "make build";
    if (t.has("test")) mk.test = "make test";
    if (t.has("lint")) mk.lint = "make lint";
    if (Object.keys(mk).length) {
      fill(mk, true);
      sources.push("Makefile");
    }
  }
  // CI workflows: what actually runs green — the strongest hint.
  const wfs = Object.entries(f).filter(([k]) => k.startsWith(".github/workflows/"));
  if (wfs.length) {
    const ci = ciSetup(wfs.map(([, v]) => v));
    if (Object.keys(ci.cmds).length) {
      fill(ci.cmds, true);
      sources.push(...wfs.map(([k]) => k));
    }
    for (const [k, v] of Object.entries(ci.runtimes)) runtimes[k] ??= v;
    ci.env.forEach((e) => env.add(e));
  }
  // Pinned tool versions win over ranges from manifests.
  for (const line of (f[".tool-versions"] ?? "").split("\n")) {
    const m = line.trim().match(/^([\w.+-]+)\s+(\S+)/);
    if (m && !m[1].startsWith("#")) runtimes[m[1] === "nodejs" ? "node" : m[1]] = m[2];
  }
  const nv = (f[".nvmrc"] ?? f[".node-version"])?.trim().split("\n")[0];
  if (nv) runtimes.node = nv.replace(/^v/, "");
  for (const name of [".env.example", ".env.sample", ".env.template"]) if (f[name] !== undefined) envExampleNames(f[name]).forEach((e) => env.add(e));

  const profile = sanitizeProfile({ ...cmds, runtimes, envVars: [...env], detectedAt: now, ...(sources.length ? { notes: `Detected from ${[...new Set(sources)].join(", ")}.` } : {}) }, "detected", now);
  return isEmptyProfile(profile) ? null : profile;
}

// ---------------------------------------------------------------------------------------------------
// The agent's sentinel

/**
 * Parse SETUP_SENTINEL. Shape: `{ "<repo dir name>": {install, build, test, lint, runtimes,
 * envVars, notes} }`, or — for a single-repo box — the profile object itself. Returns name → profile.
 */
export function parseSentinel(text: string, repoNames: string[], now = Date.now()): Record<string, SetupProfile> {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return {};
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return {};
  const o = j as Record<string, unknown>;
  const out: Record<string, SetupProfile> = {};
  const looksLikeProfile = ["install", "build", "test", "lint", "runtimes", "envVars"].some((k) => k in o);
  if (looksLikeProfile) {
    if (repoNames.length === 1) out[repoNames[0]] = sanitizeProfile(o, "agent", now);
    return out;
  }
  for (const name of repoNames) if (o[name] && typeof o[name] === "object") out[name] = sanitizeProfile(o[name], "agent", now);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Prompt

/**
 * The system-prompt block for one repo. States the facts (what was installed, what the commands
 * are) and the one ask: correct the profile via the sentinel. Env var names only.
 */
export function setupPromptHint(
  name: string,
  p: SetupProfile,
  opts: { installed?: "ok" | "failed" | "skipped"; multi?: boolean } = {}
): string {
  const dir = `/workspace/${name}`;
  const known = p.confirmedBy === "detected" ? `Setup for ${dir} (auto-detected from its files, unconfirmed):` : `Setup for ${dir} (learned from earlier runs):`;
  const bits: string[] = [];
  if (p.install) {
    bits.push(
      opts.installed === "ok"
        ? `dependencies were already installed with \`${p.install}\``
        : opts.installed === "failed"
          ? `pre-installing with \`${p.install}\` failed — run it yourself if you need dependencies`
          : `install: \`${p.install}\``
    );
  }
  if (p.build) bits.push(`build: \`${p.build}\``);
  if (p.test) bits.push(`test: \`${p.test}\``);
  if (p.lint) bits.push(`lint: \`${p.lint}\``);
  const rt = Object.entries(p.runtimes).map(([k, v]) => `${k} ${v}`);
  if (rt.length) bits.push(`runtimes: ${rt.join(", ")}`);
  if (p.envVars.length) bits.push(`env vars it expects (names only; set only if provided): ${p.envVars.join(", ")}`);
  if (p.notes && p.confirmedBy !== "detected") bits.push(`notes: ${p.notes}`);
  const shape = opts.multi ? `{"${name}": {"install","build","test","lint","runtimes","envVars","notes"}}` : `{"install","build","test","lint","runtimes","envVars","notes"}`;
  return (
    `${known} ${bits.join("; ")}. If any of this is wrong or incomplete once you know better, write the ` +
    `corrected setup as JSON ${shape} to ${SETUP_SENTINEL} — env var NAMES only, never values or secrets.`
  );
}

/** For a repo with no profile and nothing detectable: just the ask. */
export function setupAskHint(names: string[]): string {
  const multi = names.length > 1;
  return (
    `If you work out how ${multi ? "these repos install" : "this repo installs"}, build${multi ? "" : "s"} and test${multi ? "" : "s"}, write it as JSON ` +
    `${multi ? `{"<dir name>": {"install","build","test","lint","runtimes","envVars","notes"}}` : `{"install","build","test","lint","runtimes","envVars","notes"}`} ` +
    `to ${SETUP_SENTINEL} so later runs start ready — env var NAMES only, never values or secrets.`
  );
}
