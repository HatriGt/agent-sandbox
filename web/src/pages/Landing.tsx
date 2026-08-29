import * as React from "react";
import { Link } from "react-router";
import { ArrowRight, Box, Check, Circle, CircleDot, Cpu, Flame, GitBranch, Globe, KeyRound, Laptop, MessageCircleQuestion, MoonStar, Pause, Plug, Server, ShieldCheck, Terminal, Timer, UserRound, X } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth";

/**
 * The public landing page. No data, no token — the product explained and DEMONSTRATED: the hero is a
 * live, self-running replay of a delegation (task → warm claim → plan → steps → question → answer →
 * done), built from the same visual vocabulary as the console so what you see is what you get.
 */
export default function Landing() {
  const { ready, config, me, token } = useSession();
  const saas = config?.mode === "saas";
  const signedIn = !!(me || token);
  // Where the primary button goes: the console when signed in (or token mode), otherwise sign-up.
  const consoleHref = { pathname: !saas || signedIn ? "/dashboard" : config?.signup ? "/signup" : "/signin" };
  const primaryLabel = !ready ? "Open the console" : !saas || signedIn ? "Open the console" : config?.signup ? "Get started" : "Sign in";
  const SELF_HOST = "https://github.com/HatriGt/agent-sandbox/blob/main/docs/self-hosting.md";
  return (
    <div className="dark bg-background text-foreground min-h-full overflow-y-auto">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-md">
            <Logo className="size-[18px]" />
          </span>
          <span className="text-body font-semibold tracking-[-0.01em]">Agent Sandbox</span>
        </div>
        <nav className="flex items-center gap-1">
          <a href="#how" className="text-muted-foreground hover:text-foreground hidden rounded-md px-3 py-1.5 text-meta sm:inline-block">
            How it works
          </a>
          <a href="#trust" className="text-muted-foreground hover:text-foreground hidden rounded-md px-3 py-1.5 text-meta sm:inline-block">
            Isolation
          </a>
          <a href="#selfhost" className="text-muted-foreground hover:text-foreground hidden rounded-md px-3 py-1.5 text-meta sm:inline-block">
            Self-host
          </a>
          <a
            href="https://github.com/HatriGt/agent-sandbox"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground hidden rounded-md px-3 py-1.5 text-meta sm:inline-block"
          >
            GitHub
          </a>
          {saas && !signedIn && (
            <Link to="/signin" className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-meta whitespace-nowrap">
              Sign in
            </Link>
          )}
          <Link
            to={consoleHref}
            className="bg-primary text-primary-foreground hover:bg-primary/80 ml-1 inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-meta font-medium whitespace-nowrap sm:ml-2"
          >
            {primaryLabel}
            <ArrowRight className="size-3.5" />
          </Link>
        </nav>
      </header>

      {/* ───────────── hero ───────────── */}
      <section className="relative isolate">
        <HairlineGrid />
        <div className="mx-auto grid max-w-6xl items-start gap-12 px-6 pt-10 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <div>
          <Reveal>
            <p className="text-live label mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1">
              <span className="bg-live breathe size-1.5 rounded-full" />
              A cloud sandbox for coding agents · hosted, or on your own server
            </p>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="font-serif text-[clamp(2.4rem,5.2vw,4.1rem)] leading-[1.05] tracking-[-0.02em] text-balance">
              Delegate the task.
              <br />
              Keep the control.
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-muted-foreground mt-5 max-w-[52ch] text-lead leading-relaxed">
              Hand a coding task to an autonomous agent running inside a throwaway microVM — from Cursor, Claude Code,
              Codex, VS Code or any agentic IDE that speaks MCP, from this dashboard, or from a script. Watch it work
              live, answer the one question it stops to ask, and get a pull request back.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to={consoleHref}
                className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-11 items-center gap-2 rounded-md px-5 text-body font-medium shadow-e1"
              >
                {primaryLabel}
                <ArrowRight className="size-4" />
              </Link>
              {saas && signedIn ? (
                <Link to="/dashboard/connect" className="border-line-strong hover:bg-muted inline-flex h-11 items-center gap-2 rounded-md border px-5 text-body font-medium">
                  <Plug className="size-4" />
                  Connect your IDE
                </Link>
              ) : (
                <a href="#selfhost" className="border-line-strong hover:bg-muted inline-flex h-11 items-center gap-2 rounded-md border px-5 text-body font-medium">
                  <Server className="size-4" />
                  Self-host
                </a>
              )}
            </div>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="text-muted-foreground mt-8 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-micro">
              <span className="label mr-1">Works with</span>
              {["Cursor", "Claude Code", "Codex", "VS Code", "Windsurf", "Zed", "any MCP client"].map((n) => (
                <span key={n} className="rounded-md border px-2 py-0.5 font-medium">
                  {n}
                </span>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.2}>
            <dl className="text-muted-foreground mt-10 grid max-w-md grid-cols-3 gap-6 text-meta">
              <Stat value="<1s" label="warm start from the pool" />
              <Stat value="KVM" label="hardware isolation per run" />
              <Stat value="0" label="secrets in the browser" />
            </dl>
          </Reveal>
        </div>
        <Reveal delay={0.12} className="min-w-0">
          <Demo />
        </Reveal>
        </div>
      </section>

      {/* ───────────── architecture ───────────── */}
      {/* ───────────── hosted or yours ───────────── */}
      <section id="selfhost" className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2 className="font-serif text-[clamp(1.8rem,3.2vw,2.5rem)] leading-tight tracking-[-0.015em]">Use this one, or run your own.</h2>
            <p className="text-muted-foreground mt-3 max-w-[60ch] text-body">
              Agent Sandbox is open source. Sign up here and get a private workspace on this controller — or put the same
              software on a VPS you control. Either way, what is yours stays yours.
            </p>
          </Reveal>
          <div className="mt-10 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
            <Reveal delay={0.04}>
              <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 30 }} className="bg-card flex h-full min-w-0 flex-col rounded-xl p-6 shadow-e2">
                <div className="flex items-center gap-2.5">
                  <span className="bg-live/10 text-live grid size-9 place-items-center rounded-md">
                    <UserRound className="size-4" />
                  </span>
                  <h3 className="text-h3 font-semibold tracking-[-0.01em]">Hosted here</h3>
                </div>
                <p className="text-muted-foreground mt-3 flex-1 text-body leading-relaxed">
                  Create an account and start a task in under a minute. Your machines, GitHub accounts and MCP servers are
                  yours alone — encrypted at rest, injected only into your runs. Connect Cursor or Claude Code with a
                  personal API key when you want to.
                </p>
                <ul className="text-muted-foreground mt-4 flex flex-col gap-1.5 text-meta">
                  <li className="flex items-center gap-2"><Check className="text-ok size-3.5" /> Private workspace per person</li>
                  <li className="flex items-center gap-2"><Check className="text-ok size-3.5" /> Warm machines, live thread, question cards</li>
                  <li className="flex items-center gap-2"><Check className="text-ok size-3.5" /> Personal API keys for your IDE</li>
                </ul>
                <div className="mt-6">
                  <Link to={consoleHref} className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-10 items-center gap-2 rounded-md px-4 text-meta font-medium">
                    {primaryLabel}
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
              </motion.div>
            </Reveal>
            <Reveal delay={0.1}>
              <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 30 }} className="bg-card flex h-full min-w-0 flex-col rounded-xl p-6 shadow-e2">
                <div className="flex items-center gap-2.5">
                  <span className="bg-muted text-foreground grid size-9 place-items-center rounded-md">
                    <Server className="size-4" />
                  </span>
                  <h3 className="text-h3 font-semibold tracking-[-0.01em]">Self-host</h3>
                </div>
                <p className="text-muted-foreground mt-3 text-body leading-relaxed">
                  One VPS with KVM, Docker and microsandbox. Single-operator by default; flip <code className="bg-muted rounded px-1 font-mono text-[0.9em]">AUTH_MODE=saas</code> for
                  sign-up, sessions and per-user isolation on your own domain.
                </p>
                <pre className="bg-background/60 text-foreground mt-4 min-w-0 max-w-full flex-1 overflow-x-auto rounded-md p-3 font-mono text-code leading-relaxed break-all whitespace-pre-wrap sm:break-normal sm:whitespace-pre">{`git clone https://github.com/HatriGt/agent-sandbox
cd agent-sandbox && cp .env.example .env
docker compose up -d --build`}</pre>
                <div className="mt-6 flex items-center gap-3">
                  <a href={SELF_HOST} target="_blank" rel="noreferrer" className="border-line-strong hover:bg-muted inline-flex h-10 items-center gap-2 rounded-md border px-4 text-meta font-medium">
                    Self-hosting guide
                    <ArrowRight className="size-4" />
                  </a>
                  <a href="https://github.com/HatriGt/agent-sandbox" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground text-meta">
                    Source · MIT
                  </a>
                </div>
              </motion.div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2 className="font-serif text-[clamp(1.8rem,3.2vw,2.5rem)] leading-tight tracking-[-0.015em]">How a task travels.</h2>
            <p className="text-muted-foreground mt-3 max-w-[60ch] text-body">
              Every entry point speaks MCP to one small controller. It drives microsandbox over SSH, boots or claims a
              KVM microVM, injects <em>your</em> GitHub credential, and streams the agent's transcript back to you alone.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <Architecture />
          </Reveal>
        </div>
      </section>

      {/* ───────────── three ways in ───────────── */}
      <section id="how" className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2 className="font-serif text-[clamp(1.8rem,3.2vw,2.5rem)] leading-tight tracking-[-0.015em]">
              One sandbox. Three ways to hand it work.
            </h2>
            <p className="text-muted-foreground mt-3 max-w-[60ch] text-body">
              The controller speaks MCP, so the same tools are available wherever you already work. Every entry point
              lands in the same microVM, the same live thread, the same question card.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <Way
              icon={<Plug className="size-5" />}
              title="From your agentic IDE"
              body="Add the MCP server to Cursor, Claude Code, Codex, VS Code or Windsurf. Say “delegate this” and your working tree — uncommitted changes included — is shipped into a sandbox. Questions come back as the IDE's own prompts."
              code={`"agent-sandbox": {\n  "url": "https://…/mcp",\n  "headers": { "Authorization": "Bearer …" }\n}`}
              delay={0}
            />
            <Way
              icon={<Terminal className="size-5" />}
              title="From the dashboard"
              body="Describe a task, attach a repo and branch, press Enter. A warm machine picks it up in seconds. Follow along on your phone; answer when it asks."
              code={`Fix the flaky retry test in\npackages/queue and open a PR\n\n@ owner/repo · main`}
              delay={0.06}
            />
            <Way
              icon={<Box className="size-5" />}
              title="From anywhere with MCP"
              body="Claude web, another IDE, CI. Same tools — delegate, status, resume, ask, teardown — behind your personal API key."
              code={`delegate({ source: "git",\n  repo: "owner/repo",\n  task: "run the suite…" })`}
              delay={0.12}
            />
          </div>
        </div>
      </section>

      {/* ───────────── what you see while it works ───────────── */}
      <section className="border-t">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
          <Reveal>
            <h2 className="font-serif text-[clamp(1.8rem,3.2vw,2.5rem)] leading-tight tracking-[-0.015em]">
              A conversation, not a log.
            </h2>
            <p className="text-muted-foreground mt-3 max-w-[56ch] text-body">
              The agent's output streams in as prose. Its plan is a live checklist. Its reasoning folds away until you want
              it. When it needs a decision it pauses — every tool call blocked — and you pick an option or type your own.
            </p>
            <ul className="mt-6 flex flex-col gap-3 text-body">
              <Li icon={<Pause className="text-attention-text size-4" strokeWidth={2.5} />}>Ask-and-stop: a real pause, enforced by a hook, not a hope.</Li>
              <Li icon={<MessageCircleQuestion className="text-muted-foreground size-4" />}>Side questions: a read-only helper explains the run without interrupting it.</Li>
              <Li icon={<Timer className="text-muted-foreground size-4" />}>Queued follow-ups: type while it works; delivered when the turn ends.</Li>
              <Li icon={<GitBranch className="text-muted-foreground size-4" />}>@-mention any file in the checked-out repos.</Li>
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="flex flex-col gap-4">
              <QuestionMock />
              <TestMock />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ───────────── trust ───────────── */}
      <section id="trust" className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2 className="font-serif text-[clamp(1.8rem,3.2vw,2.5rem)] leading-tight tracking-[-0.015em]">
              Built for code you didn't write yet.
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            <Feature icon={<ShieldCheck />} title="microVM isolation" body="Every run gets its own KVM microVM (microsandbox). Model-generated code never touches your host — a hardware boundary, not a container namespace." />
            <Feature icon={<Flame />} title="Warm pool" body="Pre-booted machines wait with the agent installed. A new task starts in seconds instead of a cold boot." />
            <Feature icon={<KeyRound />} title="Credential broker" body="GitHub accounts live on the controller, encrypted, never in the browser. The right account is injected per repo; if an agent asks for auth, the controller answers." />
            <Feature icon={<Timer />} title="Honest lifecycle" body="A run cap and an idle limit you configure. Quiet machines sleep with their workspace intact and wake on your reply; only you (or the cap) destroy anything." />
            <Feature icon={<MoonStar />} title="Nothing hidden, nothing invented" body="The dashboard shows what is alive right now — capacity slots, real deadlines, real vitals. No fabricated analytics." />
            <Feature icon={<Cpu />} title="Yours alone" body="Every machine has one owner. GitHub accounts and MCP servers are encrypted per user and reach only that user's runs; another account's box answers 404, not 403." />
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-12 md:flex-row md:items-center">
          <div>
            <p className="font-serif text-h2 tracking-[-0.01em]">Ready when you are.</p>
            <p className="text-muted-foreground mt-1 text-meta">{saas && !signedIn ? "Create an account, add a GitHub account, start a task." : "Open the console, add a GitHub account, start a task."}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link to={consoleHref} className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-10 items-center gap-2 rounded-md px-4 text-meta font-medium">
              {primaryLabel}
              <ArrowRight className="size-4" />
            </Link>
            <a href={SELF_HOST} target="_blank" rel="noreferrer" className="border-line-strong hover:bg-muted inline-flex h-10 items-center gap-2 rounded-md border px-4 text-meta font-medium">
              <Server className="size-4" />
              Self-host
            </a>
            <a href="https://github.com/HatriGt/agent-sandbox" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground text-meta">
              Source · MIT
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ───────────────────────────── building blocks ───────────────────────────── */

/**
 * Fade-and-rise once, when the block scrolls into view. A 1.6s fallback shows the block regardless,
 * so content can never stay hidden if an observer misfires (print, full-page capture, odd embeds).
 */
function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.15 });
  const [forced, setForced] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(() => setForced(true), 1600);
    return () => window.clearTimeout(t);
  }, []);
  const show = reduced || inView || forced;
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={show ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="text-foreground font-serif text-h1 tracking-[-0.02em]">{value}</dt>
      <dd className="mt-0.5 text-micro">{label}</dd>
    </div>
  );
}

function Li({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="bg-muted mt-0.5 grid size-7 shrink-0 place-items-center rounded-md">{icon}</span>
      <span className="text-foreground leading-relaxed">{children}</span>
    </li>
  );
}

function Way({ icon, title, body, code, delay }: { icon: React.ReactNode; title: string; body: string; code: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <motion.div whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }} className="bg-card flex h-full flex-col rounded-xl border p-6">
        <span className="bg-muted text-foreground grid size-10 place-items-center rounded-md">{icon}</span>
        <h3 className="mt-4 text-h3 font-semibold tracking-[-0.01em]">{title}</h3>
        <p className="text-muted-foreground mt-2 flex-1 text-body leading-relaxed">{body}</p>
        <pre className="bg-trace text-trace-fg mt-5 overflow-x-auto rounded-md px-3.5 py-3 font-mono text-micro leading-relaxed">{code}</pre>
      </motion.div>
    </Reveal>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Reveal>
      <div className="flex gap-4">
        <span className="bg-muted text-foreground grid size-10 shrink-0 place-items-center rounded-md [&_svg]:size-5">{icon}</span>
        <div>
          <h3 className="text-body font-semibold">{title}</h3>
          <p className="text-muted-foreground mt-1 text-meta leading-relaxed">{body}</p>
        </div>
      </div>
    </Reveal>
  );
}

/* ───────────────────────────── the self-running demo ───────────────────────────── */

type Frame =
  | { kind: "task"; text: string }
  | { kind: "state"; state: "assigning" | "working" | "needs you" | "done" }
  | { kind: "say"; text: string }
  | { kind: "plan"; items: Array<[string, "done" | "active" | "todo"]> }
  | { kind: "steps"; label: string }
  | { kind: "question" }
  | { kind: "answer"; text: string }
  | { kind: "reset" };

const SCRIPT: Array<[number, Frame]> = [
  [0, { kind: "reset" }],
  [400, { kind: "task", text: "Fix the flaky retry test in packages/queue and open a PR" }],
  [900, { kind: "state", state: "assigning" }],
  [1500, { kind: "state", state: "working" }],
  [1900, { kind: "say", text: "Claimed a warm machine. Reading the failing test first." }],
  [2600, { kind: "plan", items: [["Read the failing test", "active"], ["Find the timing assumption", "todo"], ["Fix + regression test", "todo"], ["Open the PR", "todo"]] }],
  [3600, { kind: "steps", label: "3 steps · Read · Grep · Bash" }],
  [4600, { kind: "plan", items: [["Read the failing test", "done"], ["Find the timing assumption", "done"], ["Fix + regression test", "active"], ["Open the PR", "todo"]] }],
  [5200, { kind: "say", text: "The assertion depends on wall-clock time. Two reasonable fixes." }],
  [6000, { kind: "state", state: "needs you" }],
  [6000, { kind: "question" }],
  [8600, { kind: "answer", text: "Mock the clock with a fake timer" }],
  [9200, { kind: "state", state: "working" }],
  [10200, { kind: "steps", label: "4 steps · Edit · Bash · Bash · Bash" }],
  [11400, { kind: "plan", items: [["Read the failing test", "done"], ["Find the timing assumption", "done"], ["Fix + regression test", "done"], ["Open the PR", "done"]] }],
  [11800, { kind: "say", text: "Opened PR #142 — 1 file changed, 12 tests pass, flake reproduced and fixed." }],
  [12400, { kind: "state", state: "done" }],
  [16500, { kind: "reset" }],
];

function Demo() {
  const reduced = useReducedMotion();
  const [state, setState] = React.useState<"assigning" | "working" | "needs you" | "done" | null>(null);
  const [items, setItems] = React.useState<Array<Frame>>([]);
  const [plan, setPlan] = React.useState<Array<[string, "done" | "active" | "todo"]> | null>(null);
  const [answered, setAnswered] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (reduced) {
      // Static final frame for reduced motion: the finished run.
      setState("done");
      setPlan(SCRIPT.filter((f) => f[1].kind === "plan").at(-1)![1].kind === "plan" ? (SCRIPT.filter((f) => f[1].kind === "plan").at(-1)![1] as Extract<Frame, { kind: "plan" }>).items : null);
      setItems(SCRIPT.map((f) => f[1]).filter((f) => f.kind === "task" || f.kind === "say" || f.kind === "steps" || f.kind === "question"));
      setAnswered("Mock the clock with a fake timer");
      return;
    }
    let timers: number[] = [];
    const runOnce = () => {
      timers.forEach(clearTimeout);
      timers = SCRIPT.map(([at, f]) =>
        window.setTimeout(() => {
          if (f.kind === "reset") {
            setState(null);
            setItems([]);
            setPlan(null);
            setAnswered(null);
          } else if (f.kind === "state") setState(f.state);
          else if (f.kind === "plan") setPlan(f.items);
          else if (f.kind === "answer") setAnswered(f.text);
          else setItems((prev) => [...prev, f]);
        }, at)
      );
    };
    runOnce();
    const loop = window.setInterval(runOnce, 17_000);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(loop);
    };
  }, [reduced]);

  const pill =
    state === "working"
      ? "bg-live/10 text-live ring-live/20"
      : state === "needs you"
        ? "bg-attention/20 text-attention-text ring-attention/40"
        : state === "done"
          ? "bg-ok/10 text-ok ring-ok/20"
          : "bg-muted text-muted-foreground ring-border";

  return (
    <div className="bg-card relative overflow-hidden rounded-xl border shadow-e5">
      <div className="flex h-12 items-center gap-2.5 border-b px-4">
        <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset transition-colors duration-300", pill)}>
          {state === "working" && <CircleDot className="size-3 breathe" strokeWidth={2.5} />}
          {state === "needs you" && <Pause className="size-3" strokeWidth={2.5} />}
          {state === "done" && <Check className="size-3" strokeWidth={2.5} />}
          {state ?? "idle"}
        </span>
        <span className="text-foreground min-w-0 truncate text-meta font-medium">Fix the flaky retry test in packages/queue</span>
        <span className="stamp text-muted-foreground ml-auto hidden sm:inline">glint-otter</span>
      </div>
      {/* Fixed height: the replay grows and shrinks, and the hero copy beside it must not move. */}
      <div className="flex h-[27rem] flex-col gap-4 overflow-hidden px-5 py-5 text-meta">
        {items.map((f, i) =>
          f.kind === "task" ? (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
              <span className="bg-muted max-w-[80%] rounded-xl rounded-br-md px-3.5 py-2">{f.text}</span>
            </motion.div>
          ) : f.kind === "say" ? (
            <motion.p key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-foreground max-w-[60ch] leading-relaxed">
              <span className="label text-muted-foreground mb-1 flex items-center gap-1.5">
                <span className="bg-muted-foreground/60 size-1.5 rounded-full" /> Agent
              </span>
              {f.text}
            </motion.p>
          ) : f.kind === "steps" ? (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <span className="text-muted-foreground inline-flex items-center gap-2 rounded-md border px-3 py-1.5">
                <Terminal className="size-3.5" /> {f.label}
              </span>
            </motion.div>
          ) : f.kind === "question" ? (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="border-attention/50 rounded-xl border">
              <p className="px-4 pt-3 pb-2 font-medium">Which fix should I apply?</p>
              <ul className="flex flex-col gap-1 px-2 pb-2">
                {["Mock the clock with a fake timer", "Widen the tolerance to 200ms"].map((o) => {
                  const on = answered === o;
                  return (
                    <li key={o} className={cn("flex items-center gap-2.5 rounded-md border px-3 py-1.5 transition-colors", on ? "border-attention bg-attention/10" : "border-transparent")}>
                      <span className={cn("grid size-4 place-items-center rounded-full border", on ? "border-attention bg-attention text-attention-ink" : "border-line-strong")}>
                        {on && <Check className="size-2.5" strokeWidth={3} />}
                      </span>
                      {o}
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          ) : null
        )}
        {plan && (
          <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border">
            <div className="flex items-center gap-2 border-b px-3.5 py-2">
              <span className="text-foreground font-medium">Plan</span>
              <span className="text-muted-foreground tabular ml-auto">{plan.filter((p) => p[1] === "done").length}/{plan.length}</span>
            </div>
            <ol className="py-1">
              {plan.map(([t, s]) => (
                <li key={t} className={cn("flex items-center gap-2.5 px-3.5 py-1", s === "done" && "text-muted-foreground line-through", s === "active" && "font-medium")}>
                  <span className={cn("grid size-4 place-items-center rounded", s === "done" ? "bg-ok/20 text-ok" : s === "active" ? "bg-live/10 text-live" : "border")}>
                    {s === "done" ? <Check className="size-2.5" strokeWidth={3} /> : s === "active" ? <CircleDot className="size-2.5 breathe" /> : null}
                  </span>
                  {t}
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function QuestionMock() {
  return (
    <div className="bg-card rounded-xl border p-2 shadow-e5">
      <div className="border-attention/50 rounded-xl border">
        <div className="px-5 pt-4 pb-3">
          <p className="label text-attention-text mb-2 flex items-center gap-1.5">
            <Pause className="size-3" strokeWidth={2.5} /> Paused — the agent needs a decision
          </p>
          <p className="text-lead font-medium">Which database should the migration target?</p>
          <p className="text-muted-foreground mt-1.5 text-meta">The repo has both a Postgres and a SQLite config.</p>
        </div>
        <ul className="flex flex-col gap-1 px-3 pb-2">
          {["Postgres (recommended)", "SQLite", "Something else…"].map((o, i) => (
            <li key={o} className={cn("flex items-center gap-3 rounded-md border px-3 py-2.5 text-body", i === 0 ? "border-attention bg-attention/10" : "border-transparent")}>
              <span className={cn("grid size-4.5 place-items-center rounded-full border", i === 0 ? "border-attention bg-attention text-attention-ink" : "border-line-strong")}>
                {i === 0 && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="flex-1">{o}</span>
              <kbd className="text-faint">{i + 1}</kbd>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="text-muted-foreground text-micro">Pick one, then send. Every tool call is blocked until you do.</span>
          <span className="bg-attention text-attention-ink inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-meta font-medium">
            Send answer <ArrowRight className="size-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
}


/* ───────────────────────────── visual elements ───────────────────────────── */

/** A faint hairline grid under the hero — a drafting sheet, not a glow. Fades out toward the fold. */
function HairlineGrid() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklch, var(--foreground) 12%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--foreground) 12%, transparent) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(to bottom, #000 0%, #000 45%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 45%, transparent 100%)",
        }}
      />
    </div>
  );
}

/** Clients → controller → microVMs, with animated flow along the paths (SVG dash offset). */
function Architecture() {
  const reduced = useReducedMotion();
  return (
    <div className="bg-card mt-10 overflow-hidden rounded-xl border p-6 md:p-10">
      <div className="grid items-center gap-8 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div className="flex flex-col gap-3">
          <Node icon={<Laptop className="size-4" />} title="Agentic IDE" sub="Cursor · Claude Code · Codex · VS Code" />
          <Node icon={<Globe className="size-4" />} title="Dashboard" sub="this console, any device" />
          <Node icon={<Plug className="size-4" />} title="Any MCP client" sub="Claude web · CI" />
        </div>
        <Flow reduced={!!reduced} />
        <div className="flex flex-col gap-3">
          <Node icon={<Server className="size-4" />} title="Controller" sub="one bearer token · fails closed" accent />
          <ul className="text-muted-foreground flex flex-col gap-1 text-micro">
            <li className="flex items-center gap-1.5"><KeyRound className="size-3" /> credential broker</li>
            <li className="flex items-center gap-1.5"><Flame className="size-3" /> warm pool maintainer</li>
            <li className="flex items-center gap-1.5"><Timer className="size-3" /> lifecycle · queue · stream</li>
          </ul>
        </div>
        <Flow reduced={!!reduced} />
        <div className="flex flex-col gap-3">
          {["glint-otter", "teal-comet", "opal-koi"].map((n, i) => (
            <Node
              key={n}
              icon={<ShieldCheck className="size-4" />}
              title={n}
              sub={i === 0 ? "working · 12m left" : i === 1 ? "needs you" : "warm · ready"}
              tone={i === 0 ? "live" : i === 1 ? "attention" : "ok"}
            />
          ))}
          <p className="text-muted-foreground text-micro">KVM microVMs (microsandbox) on your VPS</p>
        </div>
      </div>
    </div>
  );
}

function Node({ icon, title, sub, accent, tone }: { icon: React.ReactNode; title: string; sub: string; accent?: boolean; tone?: "live" | "attention" | "ok" }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border px-3.5 py-2.5", accent && "border-line-strong shadow-e1")}>
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md",
          tone === "live" ? "bg-live/10 text-live" : tone === "attention" ? "bg-attention/20 text-attention-text" : tone === "ok" ? "bg-ok/10 text-ok" : "bg-muted text-foreground"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="text-foreground block truncate text-meta font-medium">{title}</span>
        <span className="text-muted-foreground block truncate text-micro">{sub}</span>
      </span>
    </div>
  );
}

function Flow({ reduced }: { reduced: boolean }) {
  return (
    <svg viewBox="0 0 80 24" className="text-live mx-auto h-6 w-20 rotate-90 md:rotate-0" aria-hidden>
      <path d="M2 12 H78" stroke="color-mix(in oklch, currentColor 30%, transparent)" strokeWidth="2" strokeLinecap="round" />
      <path d="M2 12 H78" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="6 10" className={reduced ? "" : "flow-dash"} />
      <path d="M70 6 L78 12 L70 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TestMock() {
  const rows: Array<[string, "pass" | "fail", string]> = [
    ["should login with valid credentials", "pass", "45ms"],
    ["should reject invalid password", "pass", "32ms"],
    ["should handle timeout", "fail", "5001ms"],
  ];
  return (
    <div className="bg-card rounded-xl border p-2 shadow-e5">
      <div className="overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5 text-meta">
          <span className="bg-ok/10 text-ok inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"><Check className="size-3" strokeWidth={3} /> 8 passed</span>
          <span className="bg-destructive/10 text-destructive inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"><X className="size-3" strokeWidth={3} /> 1 failed</span>
          <span className="bg-attention/20 text-attention-text inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"><Circle className="size-3" /> 1 skipped</span>
          <span className="text-muted-foreground tabular ml-auto">1.23s</span>
        </div>
        <div className="flex items-center gap-2.5 px-3.5 py-2 text-meta"><span className="border-destructive text-destructive grid size-4 place-items-center rounded-full border-[1.5px]"><X className="size-2.5" strokeWidth={3} /></span><span className="font-mono">auth.test.ts</span><span className="text-muted-foreground ml-auto text-micro">1 failing · 3 tests</span></div>
        <ul>
          {rows.map(([n, s, ms]) => (
            <li key={n} className="flex items-center gap-2.5 border-t py-1.5 pr-3.5 pl-10 text-meta">
              <span className={cn("grid size-3.5 place-items-center rounded-full border-[1.5px]", s === "pass" ? "border-ok text-ok" : "border-destructive text-destructive")}>
                {s === "pass" ? <Check className="size-2" strokeWidth={3} /> : <X className="size-2" strokeWidth={3} />}
              </span>
              <span className="flex-1">{n}</span>
              <span className={cn("tabular text-micro", s === "fail" ? "text-destructive" : "text-muted-foreground")}>{ms}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
