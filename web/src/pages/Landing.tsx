import * as React from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Copy, Globe, GitPullRequest, KeyRound, Moon, ScrollText, ShieldCheck, Sun } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Logo } from "@/components/ui/logo";
import { AGENT_BRANDS, MODEL_BRANDS, type Brand } from "@/components/landing/BrandMarks";
import { ScenarioDemo } from "@/components/landing/ScenarioDemo";
import { HeroFeed } from "@/components/landing/HeroFeed";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth";

/**
 * The public landing page. No data, no token. Structure (docs/plan-agent-cloud.md §3):
 *   1. hero — headline, install, a looping automations feed (HeroFeed), and the agents/models strip
 *   2. the scenario — a scripted, in-page run in the product's own UI (components/landing/ScenarioDemo)
 *   3. what's built today — an editorial numbered list, no cards; the planned item says so
 *   4. security — a two-column spec sheet on hairlines
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
            ["#demo", "See a run"],
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
          <div className="mx-auto max-w-6xl px-5 pt-8 pb-14 sm:px-6 lg:pt-16">
            <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-14">
              <div className="min-w-0">
                <Reveal>
                  <p className="text-muted-foreground label mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1">
                    <span className="bg-ok size-1.5 rounded-full" aria-hidden />
                    Your own agent cloud · public beta
                  </p>
                </Reveal>
                <Reveal delay={0.05}>
                  <h1 id="hero-title" className="font-serif text-[clamp(2.5rem,5.4vw,4.6rem)] leading-[0.98] tracking-[-0.03em] text-balance">
                    Agents on tap and on trigger. <span className="text-muted-foreground">Sandboxed in the cloud.</span>
                  </h1>
                </Reveal>
                <Reveal delay={0.1}>
                  <p className="text-foreground/85 mt-6 max-w-[50ch] text-[17px] leading-relaxed">
                    Hand it a task, or let your tools hand it one: a new issue, a failing check, a nightly schedule. It picks up
                    the work the moment it appears and brings back finished, tested changes ready to merge. You review the result
                    instead of doing the work.
                  </p>
                </Reveal>
                <Reveal delay={0.15}>
                  <CtaPair consoleHref={consoleHref} hostedLabel={hostedLabel} hostedNote={hostedNote} showHosted={saas || signedIn || !ready} />
                </Reveal>
              </div>
              <Reveal delay={0.12} className="min-w-0">
                <HeroFeed />
              </Reveal>
            </div>
            <Reveal delay={0.2}>
              <BrandStrip />
            </Reveal>
          </div>
        </section>

        {/* ───────────── 2. the scenario ───────────── */}
        <section id="demo" className="scroll-mt-4 border-t" aria-labelledby="demo-title">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
            <Reveal>
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
                <div>
                  <p className="label text-muted-foreground mb-3">Event to receipt, unattended</p>
                  <h2 id="demo-title" className="font-serif text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.05] tracking-[-0.02em] text-balance">
                    Outage at 3 a.m. Pull request in your inbox.
                  </h2>
                </div>
                <p className="text-muted-foreground max-w-[52ch] text-body leading-relaxed">
                  An error spike hits. An agent jumps on it, finds the bug, writes the fix and tests it. One quick question
                  lands on your phone. By morning, a pull request is ready to merge and the changelog is already updated.
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <ScenarioDemo />
            </Reveal>
          </div>
        </section>

        {/* ───────────── 3. built today ───────────── */}
        <section id="built" className="scroll-mt-4 border-t" aria-labelledby="built-title">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.6fr] lg:gap-16">
            <div className="lg:sticky lg:top-8 lg:self-start">
              <Reveal>
                <SectionHead id="built-title" eyebrow="Shipped" title="What's built today.">
                  Runs that start themselves, stop when they should, and leave a record. All of it is in the current release; the one
                  planned item is marked.
                </SectionHead>
              </Reveal>
            </div>
            <ol className="border-t">
              {BUILT.map((b, i) => (
                <Reveal key={b.title} delay={0.03}>
                  <li className="group grid grid-cols-[3rem_1fr] gap-x-4 border-b py-7 sm:grid-cols-[4.5rem_1fr] sm:gap-x-6">
                    <span className="text-muted-foreground/70 group-hover:text-foreground font-serif text-[2.4rem] leading-none tabular-nums transition-colors duration-200 sm:text-[3rem]" aria-hidden>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[19px] leading-snug font-semibold tracking-[-0.015em]">{b.title}</h3>
                      <p className="text-muted-foreground mt-2 max-w-[62ch] text-body leading-relaxed">{b.body}</p>
                      {b.tags && (
                        <p className="text-foreground/75 mt-3 font-mono text-micro leading-relaxed">
                          <span className="sr-only">Includes: </span>
                          {b.tags.join("  ·  ")}
                        </p>
                      )}
                    </div>
                  </li>
                </Reveal>
              ))}
              <li className="text-muted-foreground grid grid-cols-[3rem_1fr] gap-x-4 py-5 text-meta sm:grid-cols-[4.5rem_1fr] sm:gap-x-6">
                <span className="stamp pt-0.5">Next</span>
                <span>
                  <span className="text-foreground font-medium">Planned:</span> a Gemini CLI driver.
                </span>
              </li>
            </ol>
          </div>
        </section>

        {/* ───────────── 4. security ───────────── */}
        <section id="security" className="bg-sidebar/60 scroll-mt-4 border-t" aria-labelledby="security-title">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
            <Reveal>
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
                <div>
                  <p className="label text-muted-foreground mb-3">Security</p>
                  <h2 id="security-title" className="font-serif text-[clamp(1.9rem,3.6vw,2.9rem)] leading-[1.05] tracking-[-0.02em] text-balance">
                    Unattended only works if it's fenced.
                  </h2>
                </div>
                <p className="text-muted-foreground max-w-[52ch] text-body leading-relaxed">
                  A run that starts from a webhook at 3 a.m. gets the same boundary as the one you watch: a separate machine, a network
                  allowlist, and a controller that keeps the credentials.
                </p>
              </div>
            </Reveal>
            <dl className="mt-12 grid gap-x-16 sm:grid-cols-2">
              {SECURITY.map((s) => (
                <Reveal key={s.title}>
                  <div className="border-t py-6">
                    <dt className="flex items-center gap-2.5 text-body font-semibold">
                      <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>
                        {s.icon}
                      </span>
                      {s.title}
                    </dt>
                    <dd className="text-muted-foreground mt-2 text-meta leading-relaxed">{s.body}</dd>
                  </div>
                </Reveal>
              ))}
            </dl>
          </div>
        </section>

        {/* ───────────── 5. install ───────────── */}
        <section id="install" className="scroll-mt-4 border-t" aria-labelledby="install-title">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
            <Reveal>
              <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-end lg:gap-16">
                <div>
                  <h2 id="install-title" className="font-serif text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1.02] tracking-[-0.025em] text-balance">
                    Your agent cloud,
                    <br />
                    on your own server.
                  </h2>
                  <p className="text-muted-foreground mt-4 max-w-[48ch] text-body leading-relaxed">
                    One command on a KVM-capable Linux host. Open source under MIT. The hosted beta is the same product, run for you.
                  </p>
                </div>
                <div className="min-w-0">
                  <InstallCommand />
                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                    {(saas || signedIn) && (
                      <Link to={consoleHref} className={cn(focusRing, secondaryBtn)}>
                        {signedIn ? primaryLabel : saas ? "Sign up for hosted" : primaryLabel}
                        <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    )}
                    <a href={SELF_HOST} target="_blank" rel="noreferrer" className={cn(focusRing, "text-foreground rounded-sm text-meta font-medium underline decoration-current/40 underline-offset-4 hover:decoration-current")}>
                      Self-hosting guide
                    </a>
                  </div>
                  {hostedNote && <p className="text-muted-foreground mt-3 text-micro">{hostedNote}</p>}
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

const BUILT: Array<{ title: string; body: string; tags?: string[] }> = [
  {
    title: "Triggers",
    body: "Runs start from the dashboard or any MCP client, on a schedule, from a webhook, from a GitHub event, or when another automation finishes.",
    tags: ["cron + timezone", "webhook", "issue labelled", "issue comment", "PR opened", "after: chains"],
  },
  {
    title: "Budgets that ask, then stop",
    body: "Per-run caps on time, and on dollars when the model has a known price (tokens otherwise). Hitting a cap doesn't kill the run: it asks continue or stop at its next tool call.",
  },
  {
    title: "Receipts and History",
    body: "Every finished run leaves a receipt: plan, files, failed commands, the questions it asked and your answers, and what started it. History is the ledger, with filters and period totals.",
    tags: ["receipt comment on the issue or PR"],
  },
  {
    title: "Mobile push",
    body: "The phone app gets a push when a run needs you; the notification deep-links to the question card. Automations on mobile: read, toggle, Run now.",
  },
  {
    title: "Harnesses",
    body: "Save a driver, model, skills, rules, verify step, egress and budget as one harness. Export and import versioned bundles; compare two harnesses on the same task.",
    tags: ["export", "import", "compare"],
  },
  {
    title: "Your models, your accounts",
    body: "An encrypted per-user provider registry: Anthropic, OpenAI, any OpenAI-compatible endpoint, and Ollama for local models. API keys first in every picker.",
  },
];

const SECURITY: Array<{ icon: React.ReactNode; title: string; body: string }> = [
  { icon: <ShieldCheck />, title: "A microVM per run", body: "Each run gets its own KVM-isolated machine with its own kernel. Model-generated code never touches the host: a hardware boundary, not a container namespace." },
  { icon: <Globe />, title: "Egress allowlist", body: "A run reaches only the hosts its harness needs (derived from its model providers) plus the ones you add. Everything else is refused at the machine's network edge." },
  { icon: <KeyRound />, title: "Secrets kept out of the box", body: "GitHub accounts, provider keys and MCP credentials live encrypted on the controller, per user. The controller answers auth for the run; the browser never sees them." },
  { icon: <ScrollText />, title: "Audit log", body: "Sign-ins, key changes, runs started, triggers and teardowns are recorded and readable by their owner. Another account's machine answers 404, not 403." },
  { icon: <GitPullRequest />, title: "PR-only, enforced in git", body: "Runs an automation starts can't push to the default branch: a pre-push hook in the machine refuses it, and the controller checks again. Changes land on a branch and a PR." },
];

/* ───────────────────────────── brand strip ───────────────────────────── */

/**
 * MIRROR of the server driver registry (the web bundle can't import src/drivers). `soon` = planned,
 * not built (Gemini CLI). Keep in sync when a driver changes.
 */
function BrandStrip() {
  return (
    <div className="mt-16 lg:mt-20">
      <BrandGroup label="Runs any agent" brands={AGENT_BRANDS} />
      <BrandGroup label="On any model or account" brands={MODEL_BRANDS} />    </div>
  );
}

function BrandGroup({ label, brands }: { label: string; brands: Brand[] }) {
  return (
    <div className="grid gap-3 border-t py-5 md:grid-cols-[12rem_minmax(0,1fr)] md:items-center md:gap-8">
      <p className="label text-muted-foreground">{label}</p>
      <ul className="flex flex-wrap items-center gap-x-9 gap-y-3">
        {brands.map((b) => (
          <li
            key={b.key}
            className={cn(
              "flex h-7 items-center gap-2 text-[16px] transition-colors duration-200 ease-out",
              b.soon ? "text-foreground/40" : "text-foreground/65 hover:text-foreground"
            )}
            title={b.soon ? `${b.name}: coming soon` : b.name}
          >
            <span className="sr-only">{b.soon ? `${b.name} (coming soon)` : b.name}</span>
            <span aria-hidden className="flex items-center gap-2">
              {b.render("size-[18px] shrink-0")}
            </span>
            {b.soon && (
              <span aria-hidden className="text-muted-foreground rounded-full border border-dashed px-1.5 py-px text-[10px] leading-tight font-medium tracking-wide">
                soon
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
