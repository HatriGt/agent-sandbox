import * as React from "react";
import { Link } from "react-router";
import { TriangleAlert, ArrowRight, Box, Check, Circle, CircleDot, Clock, Copy, Smartphone, Cpu, Flame, GitBranch, Globe, KeyRound, Laptop, MessageCircleQuestion, Pause, Plug, Server, ShieldCheck, Terminal, Timer, X } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth";

/**
 * The public landing page. No data, no token. The hero is the honest drivers × model-sources matrix
 * (available · supervised: partial · planned, mirrored from the driver registry); below it, a self-running replay of one delegation beside its steps, then
 * security and the one-command self-host install (primary) with hosted signup (secondary).
 */
export default function Landing() {
  const { ready, config, me, token } = useSession();
  const saas = config?.mode === "saas";
  const signedIn = !!(me || token);
  // Where the primary button goes: the console when signed in (or token mode), otherwise sign-up.
  const consoleHref = { pathname: !saas || signedIn ? "/dashboard" : config?.signup ? "/signup" : "/signin" };
  const beta = !!config?.beta;
  const trialDays = config?.trialDays ?? 0;
  const primaryLabel = !ready ? "Open the console" : !saas || signedIn ? "Open the console" : config?.signup ? "Start for free" : "Sign in";
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
          <a href="#demo" className="text-muted-foreground hover:text-foreground hidden rounded-md px-3 py-1.5 text-meta sm:inline-block">
            Demo
          </a>
          <a href="#trust" className="text-muted-foreground hover:text-foreground hidden rounded-md px-3 py-1.5 text-meta sm:inline-block">
            Security
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
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-12 px-6 pt-10 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <div className="min-w-0">
          <Reveal>
            <p className="text-live label mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1">
              <span className="bg-live breathe size-1.5 rounded-full" />
              Public beta · free while it lasts
            </p>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="font-serif text-[clamp(2.4rem,5.2vw,4.1rem)] leading-[1.05] tracking-[-0.02em] text-balance">
              Your own agent cloud.
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-muted-foreground mt-5 max-w-[52ch] text-lead leading-relaxed">
              Any coding agent, any model, any account. Every run in its own microVM. Always on: manual, scheduled,
              event-triggered, long-running. When it needs a decision, it asks instead of guessing.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mt-7 flex max-w-xl flex-col gap-3">
              <InstallCommand />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link
                  to={consoleHref}
                  className="border-line-strong hover:bg-muted inline-flex h-10 items-center gap-2 rounded-md border px-4 text-meta font-medium transition-colors duration-200 ease-out"
                >
                  {saas && !signedIn && primaryLabel !== "Sign in" ? "Or use the hosted beta" : primaryLabel}
                  <ArrowRight className="size-3.5" />
                </Link>
                <span className="text-muted-foreground text-micro">
                  {saas && !signedIn ? (beta ? "Hosted is free during the public beta · no card." : trialDays ? `Hosted: ${trialDays} days free · no card.` : "") : "Self-host is free forever · MIT."}
                </span>
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="text-muted-foreground mt-8 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-micro">
              <span className="label mr-1">Delegate from</span>
              {["Cursor", "Claude Code", "Codex", "VS Code", "Windsurf", "Zed", "any MCP client"].map((n) => (
                <span key={n} className="rounded-md border px-2 py-0.5 font-medium">
                  {n}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
        <Reveal delay={0.12} className="min-w-0">
          <Matrix />
        </Reveal>
        </div>
      </section>

      {/* ───────────── the 30-second demo ───────────── */}
      <section id="demo" className="border-t">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-12 px-6 py-20 lg:grid-cols-[1fr_1.05fr]">
          <div className="min-w-0">
            <Reveal>
              <h2 className="font-serif text-[clamp(1.8rem,3.2vw,2.5rem)] leading-tight tracking-[-0.015em]">One run, start to receipt.</h2>
              <p className="text-muted-foreground mt-3 max-w-[56ch] text-body">
                What a delegated run looks like end to end. The question is a real pause — a hook blocks every tool call
                until you answer.
              </p>
            </Reveal>
            <ol className="mt-8 flex flex-col gap-3">
              {DEMO_STEPS.map((st, i) => (
                <Reveal key={st.title} delay={i * 0.04}>
                  <li className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", st.needsYou && "border-attention/50")}>
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4", st.needsYou ? "bg-attention/20 text-attention-text" : "bg-muted text-foreground")}>{st.icon}</span>
                    <span className="min-w-0">
                      <span className="text-foreground flex items-center gap-2 text-body font-medium">
                        <span className="stamp text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                        {st.title}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-meta leading-relaxed">{st.body}</span>
                    </span>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
          <Reveal delay={0.1} className="min-w-0">
            <Demo />
            <p className="text-muted-foreground mt-3 text-micro">An illustrative replay built from the console's own components.</p>
          </Reveal>
        </div>
      </section>

      {/* ───────────── architecture ───────────── */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2 className="font-serif text-[clamp(1.8rem,3.2vw,2.5rem)] leading-tight tracking-[-0.015em]">How a task travels.</h2>
            <p className="text-muted-foreground mt-3 max-w-[60ch] text-body">
              Every entry point speaks MCP to one small controller. It boots or claims a hardware-isolated sandbox,
              injects <em>your</em> GitHub credential, and streams the agent's transcript back to you alone.
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
              lands in the same sandbox, the same live thread, the same question card.
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
              <Li icon={<Pause className="text-attention-text size-4" strokeWidth={2.5} />}>Asks instead of guessing: a real pause, enforced by a hook, not a hope.</Li>
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
          <p className="text-muted-foreground mt-3 max-w-[60ch] text-body">
            Always on only works if unattended is safe. Every run is fenced by a hardware boundary, a network allowlist
            and a controller that keeps your credentials.
          </p>
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            <Feature icon={<ShieldCheck />} title="A microVM per run" body="Each run gets its own KVM-isolated machine with its own kernel. Model-generated code never touches your host — a hardware boundary, not a container namespace." />
            <Feature icon={<Globe />} title="Egress allowlist" body="Choose which hosts a run may reach. Everything else is refused at the box's network edge." />
            <Feature icon={<KeyRound />} title="Secrets kept out of the box" body="GitHub accounts and MCP credentials live encrypted on the controller, per user. The controller answers auth for the run; the browser never sees them." />
            <Feature icon={<Cpu />} title="Audit log" body="Sign-ins, key changes, delegations and teardowns are recorded and readable by their owner. Another account's box answers 404, not 403." />
          </div>
        </div>
      </section>

      {/* ───────────── install ───────────── */}
      <section id="install" className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2 className="font-serif text-[clamp(1.8rem,3.2vw,2.5rem)] leading-tight tracking-[-0.015em]">Run it on your own server.</h2>
            <p className="text-muted-foreground mt-3 max-w-[60ch] text-body">
              One command on a KVM-capable Linux host. Open source, MIT, free forever — the hosted beta is the same product,
              run for you.
            </p>
            <div className="mt-8 flex max-w-2xl flex-col gap-4">
              <InstallCommand />
              <div className="flex flex-wrap items-center gap-4">
                <a href={SELF_HOST} target="_blank" rel="noreferrer" className="text-foreground text-meta font-medium underline decoration-[oklch(0.55_0.02_286)] underline-offset-4 hover:decoration-current">
                  Self-hosting guide
                </a>
                {saas && (
                  <Link to={consoleHref} className="border-line-strong hover:bg-muted inline-flex h-10 items-center gap-2 rounded-md border px-4 text-meta font-medium transition-colors duration-200 ease-out">
                    {signedIn ? primaryLabel : "Sign up for hosted"}
                    <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-12 md:flex-row md:items-center">
          <div>
            <p className="font-serif text-h2 tracking-[-0.01em]">Ready when you are.</p>
            <p className="text-muted-foreground mt-1 text-meta">{saas && !signedIn ? (beta ? "Free during the beta. Sign up, add a GitHub account, start a task." : "Sign up, add a GitHub account, start a task.") : "Open the console, add a GitHub account, start a task."}</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="#install" className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-10 items-center gap-2 rounded-md px-4 text-meta font-medium">
              <Terminal className="size-4" />
              Self-host
            </a>
            <Link to={consoleHref} className="text-muted-foreground hover:text-foreground text-meta">
              {primaryLabel}
            </Link>
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


/* ───────────────────────────── hero matrix ───────────────────────────── */

type Cell = "available" | "partial" | "planned";
const SOURCES = [
  { key: "anthropic", label: "Anthropic" },
  { key: "openai", label: "OpenAI" },
  { key: "openai-compatible", label: "OpenAI-compatible" },
  { key: "local", label: "Local" },
] as const;
type Source = (typeof SOURCES)[number]["key"];
/**
 * MIRROR of the server registry — the web bundle can't import src/drivers (node-only modules).
 * `modelSources` = each driver's capabilities.modelSources; `supervised` = meetsSupervisionFloor
 * (gate !== "none" && resume). Provider kinds map onto sources via src/providers.ts SOURCE_OF
 * (anthropic + ccproxy → Anthropic, ollama → Local). Keep in sync when a driver changes.
 */
const DRIVERS: Array<{ label: string; modelSources: Source[]; supervised: boolean; shipped: boolean }> = [
  { label: "Claude Code", modelSources: ["anthropic"], supervised: true, shipped: true },
  { label: "oh-my-pi", modelSources: ["anthropic"], supervised: true, shipped: true },
  { label: "Codex CLI", modelSources: ["openai", "openai-compatible"], supervised: true, shipped: true },
  { label: "OpenCode", modelSources: ["anthropic", "openai", "openai-compatible", "local"], supervised: true, shipped: true },
  { label: "Gemini CLI", modelSources: [], supervised: false, shipped: false },
];
function cellOf(d: (typeof DRIVERS)[number], s: Source): Cell {
  if (!d.shipped || !d.modelSources.includes(s)) return "planned";
  return d.supervised ? "available" : "partial";
}
const CELL_LABEL: Record<Cell, string> = { available: "available", partial: "supervised: partial", planned: "planned" };

function Matrix() {
  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-e5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3">
        <span className="text-foreground text-meta font-medium">Drivers × model sources</span>
        <span className="text-muted-foreground ml-auto flex items-center gap-3 text-micro">
          <span className="inline-flex items-center gap-1"><Check className="text-ok size-3" strokeWidth={3} /> available</span>
          <span className="inline-flex items-center gap-1"><TriangleAlert className="text-attention size-3" /> supervised: partial</span>
          <span className="inline-flex items-center gap-1"><Clock className="size-3" /> planned</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-meta">
          <caption className="sr-only">Which coding agents run on which model sources today, and which are planned</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[8.5rem] px-3 py-2.5"><span className="sr-only">Driver</span></th>
              {SOURCES.map((c) => (
                <th key={c.key} scope="col" className="text-muted-foreground px-2 py-2.5 text-left text-micro font-medium">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DRIVERS.map((d) => (
              <tr key={d.label} className="border-t">
                <th scope="row" className="text-foreground px-3 py-2 text-left font-medium whitespace-nowrap">{d.label}</th>
                {SOURCES.map((c) => {
                  const cell = cellOf(d, c.key);
                  return (
                    <td key={c.key} className="px-1.5 py-1.5">
                      <span
                        className={cn(
                          "inline-flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-micro whitespace-nowrap",
                          cell === "available" && "bg-ok/10 text-ok ring-ok/25 font-semibold ring-1 ring-inset",
                          cell === "partial" && "bg-attention/10 text-attention-text ring-attention/30 font-semibold ring-1 ring-inset",
                          cell === "planned" && "text-muted-foreground border border-dashed"
                        )}
                      >
                        {cell === "available" ? <Check className="size-3 shrink-0" strokeWidth={3} /> : cell === "partial" ? <TriangleAlert className="size-3 shrink-0" /> : <Clock className="size-3 shrink-0" />}
                        {CELL_LABEL[cell]}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted-foreground flex flex-col gap-1 border-t px-4 py-3 text-micro">
        <span>Every cell: <span className="text-foreground">own microVM · asks instead of guessing</span></span>
        <span>Triggers: manual, schedules, webhooks, GitHub events and <span className="stamp">after:</span> chains</span>
      </div>
    </div>
  );
}

function InstallCommand() {
  const cmd = "git clone https://github.com/HatriGt/agent-sandbox && cd agent-sandbox && docker compose up -d --build";
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="bg-trace text-trace-fg flex items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3.5">
      <span aria-hidden className="font-mono text-micro opacity-60 select-none">$</span>
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-micro whitespace-nowrap">{cmd}</code>
      <button
        type="button"
        onClick={copy}
        className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-micro font-medium transition-colors duration-200 ease-out"
        aria-label="Copy install command"
      >
        {copied ? <Check className="size-3.5" strokeWidth={3} /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const DEMO_STEPS: Array<{ icon: React.ReactNode; title: string; body: string; needsYou?: boolean }> = [
  { icon: <CircleDot />, title: "An issue becomes a task", body: "From the dashboard, your IDE over MCP, a schedule, a webhook, or a GitHub issue labelled `agent`." },
  { icon: <Box />, title: "It runs in an isolated box", body: "A warm microVM claims the task with your repo checked out and none of your secrets inside." },
  { icon: <Pause />, title: "It asks instead of guessing", body: "At a real decision it waits; every tool call is blocked until someone answers.", needsYou: true },
  { icon: <Smartphone />, title: "You answer from your phone", body: "A push notification opens the question card in the phone app. One tap and the run continues." },
  { icon: <GitBranch />, title: "A verified PR with a receipt", body: "The pull request comes back with its verify result and a digest of what ran and what was asked." },
];

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
          <p className="text-muted-foreground text-micro">Isolated sandboxes on your own server</p>
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
