import * as React from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  Check,
  Clock,
  Copy,
  FileCheck2,
  GitPullRequest,
  Globe,
  KeyRound,
  Layers,
  Moon,
  Pause,
  Play,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Sun,
  Terminal,
  Timer,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth";

/**
 * The public landing page. No data, no token. Structure (docs/plan-agent-cloud.md §3):
 *   1. hero — the honest drivers × model-sources matrix, mirrored from the driver registry
 *   2. the demo video — the real dashboard, recorded by .shots/demo-video.mjs
 *   3. what's built today — shipped features only; planned items say so
 *   4. security
 *   5. one-command self-host install (primary), hosted signup (secondary)
 * Follows the console's theme (stored `asb-dark`, else the OS preference); both themes are first-class.
 */
export default function Landing() {
  const { ready, config, me, token } = useSession();
  const saas = config?.mode === "saas";
  const signedIn = !!(me || token);
  const consoleHref = { pathname: !saas || signedIn ? "/dashboard" : config?.signup ? "/signup" : "/signin" };
  const beta = !!config?.beta;
  const trialDays = config?.trialDays ?? 0;
  const primaryLabel = !ready ? "Open the console" : !saas || signedIn ? "Open the console" : config?.signup ? "Start for free" : "Sign in";
  const hostedLabel = saas && !signedIn && primaryLabel !== "Sign in" ? "Use the hosted beta" : primaryLabel;
  const hostedNote = saas && !signedIn ? (beta ? "Hosted is free during the public beta. No card." : trialDays ? `Hosted: ${trialDays} days free. No card.` : "") : "";
  const [dark, setDark] = useLandingTheme();

  return (
    <div className={cn("bg-background text-foreground min-h-full overflow-y-auto", dark && "dark")}>
      <a href="#main" className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-md">
            <Logo className="size-[18px]" />
          </span>
          <span className="text-body font-semibold tracking-[-0.01em]">Agent Sandbox</span>
        </div>
        <nav aria-label="Primary" className="flex items-center gap-1">
          {[
            ["#demo", "Demo"],
            ["#built", "Built today"],
            ["#security", "Security"],
          ].map(([href, label]) => (
            <a key={href} href={href} className={cn(navLink, "hidden md:inline-block")}>
              {label}
            </a>
          ))}
          <a href={GITHUB} target="_blank" rel="noreferrer" className={cn(navLink, "hidden sm:inline-block")}>
            GitHub
          </a>
          <button
            type="button"
            onClick={() => setDark(!dark)}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            className={cn(focusRing, "text-muted-foreground hover:text-foreground hover:bg-muted grid size-9 place-items-center rounded-md transition-colors duration-200 ease-out")}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          {saas && !signedIn && (
            <Link to="/signin" className={cn(navLink, "whitespace-nowrap")}>
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <main id="main">
        {/* ───────────── 1. hero ───────────── */}
        <section className="relative isolate" aria-labelledby="hero-title">
          <HairlineGrid />
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 pt-8 pb-20 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:pt-14">
            <div className="min-w-0">
              <Reveal>
                <p className="text-muted-foreground label mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1">
                  <span className="bg-ok size-1.5 rounded-full" aria-hidden />
                  Your own agent cloud · public beta
                </p>
              </Reveal>
              <Reveal delay={0.05}>
                <h1 id="hero-title" className="font-serif text-[clamp(2.5rem,5.4vw,4.25rem)] leading-[1.03] tracking-[-0.025em] text-balance">
                  Any coding agent, any model, any account.
                </h1>
              </Reveal>
              <Reveal delay={0.1}>
                <p className="text-muted-foreground mt-5 max-w-[50ch] text-lead leading-relaxed">
                  Every run in its own microVM. Always on: manual, scheduled, event-triggered, long-running. When it needs
                  a decision, it asks instead of guessing.
                </p>
              </Reveal>
              <Reveal delay={0.15}>
                <CtaPair consoleHref={consoleHref} hostedLabel={hostedLabel} hostedNote={hostedNote} showHosted={saas || signedIn || !ready} />
              </Reveal>
            </div>
            <Reveal delay={0.12} className="min-w-0">
              <Matrix />
            </Reveal>
          </div>
        </section>

        {/* ───────────── 2. the demo ───────────── */}
        <section id="demo" className="scroll-mt-4 border-t" aria-labelledby="demo-title">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
            <Reveal>
              <SectionHead id="demo-title" eyebrow="The loop" title="Triggered, asked, answered, shipped.">
                A GitHub automation starts a run. The agent reproduces the bug, hits a decision that changes what the fix
                means, and stops. One answer later it finishes on a branch with a PR and a receipt.
              </SectionHead>
            </Reveal>
            <Reveal delay={0.08}>
              <DemoVideo dark={dark} />
            </Reveal>
          </div>
        </section>

        {/* ───────────── 3. built today ───────────── */}
        <section id="built" className="scroll-mt-4 border-t" aria-labelledby="built-title">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
            <Reveal>
              <SectionHead id="built-title" eyebrow="Shipped" title="What's built today.">
                Runs that start themselves, stop when they should, and leave a record. Everything here is in the current
                release; the one planned item is marked.
              </SectionHead>
            </Reveal>
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {BUILT.map((b, i) => (
                <Reveal key={b.title} delay={(i % 3) * 0.04} className="min-w-0">
                  <article className="bg-card flex h-full flex-col rounded-xl border p-5">
                    <span className="bg-muted text-foreground grid size-9 place-items-center rounded-md [&_svg]:size-[18px]" aria-hidden>
                      {b.icon}
                    </span>
                    <h3 className="mt-4 text-body font-semibold tracking-[-0.005em]">{b.title}</h3>
                    <p className="text-muted-foreground mt-1.5 text-meta leading-relaxed">{b.body}</p>
                    {b.tags && (
                      <ul className="mt-auto flex flex-wrap gap-1.5 pt-4" aria-label={`${b.title}: included`}>
                        {b.tags.map((t) => (
                          <li key={t} className="text-foreground/80 rounded-md border px-2 py-0.5 font-mono text-micro">
                            {t}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                </Reveal>
              ))}
            </div>
            <Reveal>
              <p className="text-muted-foreground mt-5 flex items-center gap-2 text-meta">
                <Clock className="size-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="text-foreground font-medium">Planned:</span> a Gemini CLI driver.
                </span>
              </p>
            </Reveal>
          </div>
        </section>

        {/* ───────────── 4. security ───────────── */}
        <section id="security" className="scroll-mt-4 border-t" aria-labelledby="security-title">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
            <Reveal>
              <SectionHead id="security-title" eyebrow="Security" title="Unattended only works if it's fenced.">
                Runs that start from a webhook at 3 a.m. get the same boundary as the ones you watch: a separate machine,
                a network allowlist, and a controller that keeps the credentials.
              </SectionHead>
            </Reveal>
            <ul className="divide-y rounded-xl border">
              {SECURITY.map((s, i) => (
                <Reveal key={s.title} delay={i * 0.03}>
                  <li className="flex gap-4 px-5 py-4">
                    <span className="bg-muted text-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4" aria-hidden>
                      {s.icon}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-body font-semibold">{s.title}</h3>
                      <p className="text-muted-foreground mt-0.5 text-meta leading-relaxed">{s.body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ───────────── 5. install ───────────── */}
        <section id="install" className="scroll-mt-4 border-t" aria-labelledby="install-title">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
            <Reveal>
              <div className="bg-card relative overflow-hidden rounded-2xl border px-6 py-10 sm:px-10 sm:py-14">
                <div className="mx-auto max-w-2xl text-center">
                  <h2 id="install-title" className="font-serif text-[clamp(1.9rem,3.6vw,2.75rem)] leading-tight tracking-[-0.02em]">
                    Run it on your own server.
                  </h2>
                  <p className="text-muted-foreground mx-auto mt-3 max-w-[54ch] text-body">
                    One command on a KVM-capable Linux host. Open source under MIT. The hosted beta is the same product,
                    run for you.
                  </p>
                </div>
                <div className="mx-auto mt-8 max-w-2xl">
                  <InstallCommand />
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
                    <a href={SELF_HOST} target="_blank" rel="noreferrer" className={cn(focusRing, "text-foreground rounded-sm text-meta font-medium underline decoration-current/40 underline-offset-4 hover:decoration-current")}>
                      Self-hosting guide
                    </a>
                    {(saas || signedIn) && (
                      <Link to={consoleHref} className={cn(focusRing, secondaryBtn)}>
                        {signedIn ? primaryLabel : saas ? "Sign up for hosted" : primaryLabel}
                        <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    )}
                  </div>
                  {hostedNote && <p className="text-muted-foreground mt-3 text-center text-micro">{hostedNote}</p>}
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-meta sm:px-6">
          <span className="flex items-center gap-2">
            <Logo className="size-3.5" /> Agent Sandbox · MIT
          </span>
          <span className="flex items-center gap-4">
            <Link to={consoleHref} className={cn(focusRing, "hover:text-foreground rounded-sm")}>
              {primaryLabel}
            </Link>
            <a href={GITHUB} target="_blank" rel="noreferrer" className={cn(focusRing, "hover:text-foreground rounded-sm")}>
              Source
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ───────────────────────────── constants ───────────────────────────── */

const GITHUB = "https://github.com/HatriGt/agent-sandbox";
const SELF_HOST = `${GITHUB}/blob/main/docs/self-hosting.md`;
const focusRing = "focus-visible:ring-ring focus-visible:ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const navLink = cn(focusRing, "text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-meta transition-colors duration-200 ease-out");
const secondaryBtn = "border-line-strong hover:bg-muted inline-flex h-10 items-center gap-2 rounded-md border px-4 text-meta font-medium transition-colors duration-200 ease-out";

const BUILT: Array<{ icon: React.ReactNode; title: string; body: string; tags?: string[] }> = [
  {
    icon: <Workflow />,
    title: "Triggers",
    body: "Runs start from the dashboard or any MCP client, on a schedule, from a webhook, from a GitHub event, or when another automation finishes.",
    tags: ["cron + timezone", "webhook", "issue labelled", "issue comment", "PR opened", "after: chains"],
  },
  {
    icon: <Timer />,
    title: "Budgets that ask, then stop",
    body: "Per-run caps on time, and on dollars when the model has a known price (tokens otherwise). Hitting a cap doesn't kill the run: it asks continue or stop at its next tool call.",
  },
  {
    icon: <FileCheck2 />,
    title: "Receipts and History",
    body: "Every finished run leaves a receipt: plan, files, failed commands, the questions it asked and your answers, and what started it. History is the ledger, with filters and period totals.",
    tags: ["receipt comment on the issue or PR"],
  },
  {
    icon: <Smartphone />,
    title: "Mobile push",
    body: "The phone app gets a push when a run needs you; the notification deep-links to the question card. Automations on mobile: read, toggle, Run now.",
  },
  {
    icon: <Layers />,
    title: "Harnesses",
    body: "Save a driver, model, skills, rules, verify step, egress and budget as one harness. Export and import versioned bundles; compare two harnesses on the same task.",
    tags: ["export", "import", "compare"],
  },
  {
    icon: <KeyRound />,
    title: "Your models, your accounts",
    body: "An encrypted per-user provider registry: Anthropic, OpenAI, any OpenAI-compatible endpoint, and Ollama for local models. API keys first in every picker.",
  },
];

const SECURITY: Array<{ icon: React.ReactNode; title: string; body: string }> = [
  { icon: <ShieldCheck />, title: "A microVM per run", body: "Each run gets its own KVM-isolated machine with its own kernel. Model-generated code never touches the host: a hardware boundary, not a container namespace." },
  { icon: <Globe />, title: "Egress allowlist", body: "A run reaches only the hosts its harness needs (derived from its model providers) plus the ones you add. Everything else is refused at the machine's network edge." },
  { icon: <KeyRound />, title: "Secrets kept out of the box", body: "GitHub accounts, provider keys and MCP credentials live encrypted on the controller, per user. The controller answers auth for the run; the browser never sees them." },
  { icon: <ScrollText />, title: "Audit log", body: "Sign-ins, key changes, delegations, triggers and teardowns are recorded and readable by their owner. Another account's machine answers 404, not 403." },
  { icon: <GitPullRequest />, title: "PR-only, enforced in git", body: "Runs an automation starts can't push to the default branch: a pre-push hook in the machine refuses it, and the controller checks again. Changes land on a branch and a PR." },
];

/* ───────────────────────────── building blocks ───────────────────────────── */

/** Stored console preference (`asb-dark`) if there is one, else the OS preference. The toggle writes it back. */
function useLandingTheme(): [boolean, (v: boolean) => void] {
  const [dark, setDarkState] = React.useState(() => {
    try {
      const v = localStorage.getItem("asb-dark");
      if (v !== null) return v === "true" || v === "1";
    } catch {
      /* storage blocked */
    }
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  });
  const setDark = React.useCallback((v: boolean) => {
    setDarkState(v);
    try {
      localStorage.setItem("asb-dark", v ? "true" : "false");
    } catch {
      /* storage blocked */
    }
    document.documentElement.classList.toggle("dark", v);
  }, []);
  return [dark, setDark];
}

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
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={show ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.22, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function SectionHead({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label text-muted-foreground mb-3">{eyebrow}</p>
      <h2 id={id} className="font-serif text-[clamp(1.9rem,3.4vw,2.6rem)] leading-tight tracking-[-0.02em] text-balance">
        {title}
      </h2>
      <p className="text-muted-foreground mt-3 max-w-[60ch] text-body leading-relaxed">{children}</p>
    </div>
  );
}

function CtaPair({ consoleHref, hostedLabel, hostedNote, showHosted }: { consoleHref: { pathname: string }; hostedLabel: string; hostedNote: string; showHosted: boolean }) {
  return (
    <div className="mt-8 flex max-w-xl flex-col gap-3">
      <p className="label text-muted-foreground">Self-host in one command</p>
      <InstallCommand />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        {showHosted && (
          <Link to={consoleHref} className={cn(focusRing, secondaryBtn)}>
            {hostedLabel}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
        <span className="text-muted-foreground text-micro">{hostedNote || "Self-host is free forever · MIT."}</span>
      </div>
    </div>
  );
}

/* ───────────────────────────── the demo video ───────────────────────────── */

const DEMO_STEPS: Array<{ icon: React.ReactNode; title: string; body: string; at: number; needsYou?: boolean }> = [
  { icon: <Workflow />, title: "A trigger starts the run", body: "A GitHub automation on issues labelled agent. Run now stands in for the label event.", at: 0 },
  { icon: <Terminal />, title: "It works in its own microVM", body: "Reads the test, reproduces the flake, keeps a live plan.", at: 5 },
  { icon: <Pause />, title: "It stops and asks", body: "Two fixes that prove different things. Every tool call is blocked until someone answers.", at: 12, needsYou: true },
  { icon: <GitPullRequest />, title: "Answered, then shipped", body: "Edits, reruns the suite, opens the PR. The thread closes with the receipt.", at: 19 },
];

function DemoVideo({ dark }: { dark: boolean }) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [step, setStep] = React.useState(0);
  // web/public is served under the Vite base (vite.config `base: "/dashboard/"`), same origin — CSP-safe.
  const dir = "/dashboard/demo/";
  const src = dark ? `${dir}demo-dark` : `${dir}demo`;
  const poster = dark ? `${dir}demo-dark-poster.jpg` : `${dir}demo-poster.jpg`;

  // Reduced motion: never autoplay. Otherwise play only while on screen.
  React.useEffect(() => {
    const v = ref.current;
    if (!v || reduced) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.35 }
    );
    io.observe(v);
    return () => io.disconnect();
  }, [reduced, src]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  const onTime = () => {
    const t = ref.current?.currentTime ?? 0;
    let s = 0;
    DEMO_STEPS.forEach((d, i) => t >= d.at && (s = i));
    setStep(s);
  };

  return (
    <figure className="mt-10 grid gap-6 lg:grid-cols-[1fr_17.5rem] lg:items-start">
      <div className="bg-card relative overflow-hidden rounded-xl border p-1.5 shadow-e5">
        <div className="relative overflow-hidden rounded-lg border">
          <video
            key={src}
            ref={ref}
            className="block aspect-[8/5] w-full bg-[color:var(--muted)] object-cover"
            muted
            loop
            playsInline
            autoPlay={!reduced}
            preload="metadata"
            poster={poster}
            aria-label="Screen recording of the Agent Sandbox dashboard: a GitHub automation starts a run, the agent stops to ask which fix to apply, the question is answered, and the run finishes with a pull request."
            aria-describedby="demo-steps demo-note"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={onTime}
          >
            <source src={`${src}.webm`} type="video/webm" />
            <source src={`${src}.mp4`} type="video/mp4" />
          </video>
          {!playing && reduced && (
            <button
              type="button"
              onClick={toggle}
              className={cn(focusRing, "absolute inset-0 grid place-items-center bg-black/10 transition-colors duration-200 ease-out hover:bg-black/20")}
              aria-label="Play the demo video"
            >
              <span className="bg-primary text-primary-foreground inline-flex h-11 items-center gap-2 rounded-full px-5 text-meta font-medium shadow-e5">
                <Play className="size-4" aria-hidden /> Play the 30-second demo
              </span>
            </button>
          )}
          {(playing || !reduced) && (
            <button
              type="button"
              onClick={toggle}
              className={cn(focusRing, "bg-background/85 text-foreground absolute right-3 bottom-3 inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-micro font-medium backdrop-blur transition-colors duration-200 ease-out hover:bg-background")}
              aria-label={playing ? "Pause the demo video" : "Play the demo video"}
            >
              {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
              {playing ? "Pause" : "Play"}
            </button>
          )}
        </div>
      </div>
      <figcaption className="min-w-0">
        <ol id="demo-steps" className="flex flex-col gap-2">
          {DEMO_STEPS.map((d, i) => {
            const on = playing && step === i;
            return (
              <li
                key={d.title}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors duration-200 ease-out",
                  on ? (d.needsYou ? "border-attention/60 bg-attention/5" : "border-line-strong bg-muted/50") : "border-transparent"
                )}
              >
                <span
                  className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-3.5", d.needsYou ? "bg-attention/20 text-attention-text" : "bg-muted text-foreground")}
                  aria-hidden
                >
                  {d.icon}
                </span>
                <span className="min-w-0">
                  <span className="text-foreground flex items-baseline gap-2 text-meta font-semibold">
                    <span className="stamp text-muted-foreground font-normal">{String(i + 1).padStart(2, "0")}</span>
                    {d.title}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-micro leading-relaxed">{d.body}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <p id="demo-note" className="text-muted-foreground mt-4 border-t pt-3 text-micro leading-relaxed">
          UI walkthrough: the real dashboard, driven with sample run data and sped up. The repo, timings and sizes on
          screen are illustrative, not a measured result.
        </p>
      </figcaption>
    </figure>
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
 * `modelSources` = each driver's capabilities.modelSources; `supervised` = the driver's stop-and-ask
 * gate is verified live (Codex and OpenCode ship "supervised: partial" until theirs are).
 * Provider kinds map onto sources via src/providers.ts SOURCE_OF (anthropic + ccproxy → Anthropic,
 * ollama → Local). Keep in sync when a driver changes.
 */
const DRIVERS: Array<{ label: string; modelSources: Source[]; supervised: boolean; shipped: boolean }> = [
  { label: "Claude Code", modelSources: ["anthropic"], supervised: true, shipped: true },
  { label: "oh-my-pi", modelSources: ["anthropic"], supervised: true, shipped: true },
  { label: "Codex CLI", modelSources: ["openai", "openai-compatible"], supervised: false, shipped: true },
  { label: "OpenCode", modelSources: ["anthropic", "openai", "openai-compatible", "local"], supervised: false, shipped: true },
  { label: "Gemini CLI", modelSources: [], supervised: false, shipped: false },
];
function cellOf(d: (typeof DRIVERS)[number], s: Source): Cell | null {
  if (!d.shipped) return "planned";
  if (!d.modelSources.includes(s)) return null;
  return d.supervised ? "available" : "partial";
}
const CELL_LABEL: Record<Cell, string> = { available: "available", partial: "supervised: partial", planned: "planned" };

function CellIcon({ cell }: { cell: Cell }) {
  return cell === "available" ? <Check className="size-3 shrink-0" strokeWidth={3} aria-hidden /> : cell === "partial" ? <TriangleAlert className="size-3 shrink-0" aria-hidden /> : <Clock className="size-3 shrink-0" aria-hidden />;
}

function Matrix() {
  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-e5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <span className="text-foreground text-meta font-medium">Drivers × model sources</span>
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-micro sm:ml-auto">
          <span className="inline-flex items-center gap-1"><Check className="text-ok size-3" strokeWidth={3} aria-hidden /> available</span>
          <span className="inline-flex items-center gap-1"><TriangleAlert className="text-attention-text size-3" aria-hidden /> supervised: partial</span>
          <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden /> planned</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-meta">
          <caption className="sr-only">Which coding agents run on which model sources today, and which are planned. An empty cell means that pairing is not supported.</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[7.5rem] px-3 py-2.5 text-left">
                <span className="sr-only">Driver</span>
              </th>
              {SOURCES.map((c) => (
                <th key={c.key} scope="col" className="text-muted-foreground px-1.5 py-2.5 text-left text-micro font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DRIVERS.map((d) => (
              <tr key={d.label} className="border-t">
                <th scope="row" className="text-foreground px-3 py-2 text-left font-medium whitespace-nowrap">
                  {d.label}
                </th>
                {!d.shipped ? (
                  <td colSpan={SOURCES.length} className="px-1.5 py-1.5">
                    <span className="text-muted-foreground inline-flex h-7 w-full items-center gap-1.5 rounded-md border border-dashed px-2 text-micro">
                      <CellIcon cell="planned" /> planned: driver not built yet
                    </span>
                  </td>
                ) : (
                  SOURCES.map((c) => {
                    const cell = cellOf(d, c.key);
                    return (
                      <td key={c.key} className="px-1.5 py-1.5">
                        {cell ? (
                          <span
                            className={cn(
                              "inline-flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-micro font-semibold whitespace-nowrap ring-1 ring-inset",
                              cell === "available" && "bg-ok/10 text-ok ring-ok/25",
                              cell === "partial" && "bg-attention/10 text-attention-text ring-attention/30"
                            )}
                          >
                            <CellIcon cell={cell} />
                            {cell === "partial" ? "partial" : CELL_LABEL[cell]}
                            {cell === "partial" && <span className="sr-only"> (supervised: partial)</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60 flex h-7 items-center px-2 text-micro" aria-label="not supported">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="text-muted-foreground grid gap-x-6 gap-y-1.5 border-t px-4 py-3 text-micro sm:grid-cols-2">
        <div>
          <dt className="text-foreground inline font-medium">Every cell: </dt>
          <dd className="inline">own microVM, any trigger, receipt.</dd>
        </div>
        <div>
          <dt className="text-foreground inline font-medium">Partial: </dt>
          <dd className="inline">stop-and-ask gate built, not yet verified live.</dd>
        </div>
      </dl>
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
    <div className="bg-trace text-trace-fg flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3.5">
      <span aria-hidden className="font-mono text-micro opacity-60 select-none">
        $
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-micro whitespace-nowrap">{cmd}</code>
      <button
        type="button"
        onClick={copy}
        className={cn(focusRing, "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-micro font-medium transition-colors duration-200 ease-out")}
        aria-label={copied ? "Install command copied" : "Copy install command"}
      >
        {copied ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** A faint hairline grid under the hero — a drafting sheet, not a glow. Fades out toward the fold. */
function HairlineGrid() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.3]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklch, var(--foreground) 10%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--foreground) 10%, transparent) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(to bottom, #000 0%, #000 40%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 40%, transparent 100%)",
        }}
      />
    </div>
  );
}
