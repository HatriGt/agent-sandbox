import { Check, CircleDot, Pause } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The ambient brand panel beside the auth card (≥lg only). Purely decorative — a continuation of the
 * landing's force-dark hero: the hairline grid, a slow drifting glow in the live hue, the serif
 * display line, and three illustration rows drawn in the console's own state vocabulary. Nothing
 * here is data; it is the product's visual language shown, not claimed. aria-hidden throughout.
 */
export function AmbientPanel() {
  const reduced = useReducedMotion();
  return (
    <div aria-hidden className="dark bg-background text-foreground relative hidden min-h-full overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* Scoped keyframes: a very slow drift + breathe for the ambient glows. Lives here because this
          panel is the only consumer; the global reduced-motion rule zeroes durations as a backstop. */}
      <style>{`
        @keyframes auth-drift {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.9; }
          50% { transform: translate3d(-2rem, 1.5rem, 0) scale(1.08); opacity: 1; }
        }
        .auth-drift { animation: auth-drift 14s ease-in-out infinite; }
        .auth-drift-slow { animation: auth-drift 20s ease-in-out infinite reverse; }
      `}</style>
      {/* drafting-sheet grid, like the landing hero */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklch, var(--foreground) 10%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--foreground) 10%, transparent) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 90% 80% at 30% 20%, #000 0%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 80% at 30% 20%, #000 0%, transparent 75%)",
        }}
      />
      {/* one slow breathing glow in the live hue — the console's liveness idea, at ambient volume */}
      <div
        className={cn("pointer-events-none absolute -top-40 -right-32 size-[34rem] rounded-full", !reduced && "auth-drift")}
        style={{ background: "radial-gradient(circle, color-mix(in oklch, var(--live) 14%, transparent) 0%, transparent 65%)" }}
      />
      <div
        className={cn("pointer-events-none absolute -bottom-48 -left-24 size-[30rem] rounded-full", !reduced && "auth-drift-slow")}
        style={{ background: "radial-gradient(circle, color-mix(in oklch, var(--live) 9%, transparent) 0%, transparent 65%)" }}
      />

      <div className="relative">
        <p className="text-live label inline-flex items-center gap-2 rounded-full border px-3 py-1">
          <span className={cn("bg-live size-1.5 rounded-full", !reduced && "breathe")} />
          Live console
        </p>
      </div>

      <div className="relative max-w-md">
        <h2 className="font-serif text-[clamp(2rem,3vw,2.6rem)] leading-[1.1] tracking-[-0.02em] text-balance">
          Delegate the task.
          <br />
          Keep the control.
        </h2>
        <p className="text-muted-foreground mt-4 text-body leading-relaxed">
          Every task runs in its own disposable sandbox. Watch it work live, answer the one question it stops to ask, and get a pull request back.
        </p>

        {/* proof rows: the console's state pills, drawn as illustration */}
        <div className="mt-10 flex flex-col gap-3">
          <ProofRow
            pill={
              <span className="bg-attention/20 text-attention-text ring-attention/40 inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset">
                <Pause className="size-3" strokeWidth={2.5} />
                needs you
              </span>
            }
            text="pauses for your decision — every tool call blocked"
          />
          <ProofRow
            pill={
              <span className="bg-live/10 text-live ring-live/20 inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset">
                <CircleDot className={cn("size-3", !reduced && "breathe")} strokeWidth={2.5} />
                working
              </span>
            }
            text="streams its transcript to you alone"
          />
          <ProofRow
            pill={
              <span className="bg-ok/10 text-ok ring-ok/20 inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset">
                <Check className="size-3" strokeWidth={2.5} />
                done
              </span>
            }
            text="ends with a pull request, not a log dump"
          />
        </div>
      </div>

      <p className="stamp text-muted-foreground relative">
        <span className="text-ok">$</span> delegate "fix the flaky retry test" · sandbox glint-otter · isolated
      </p>
    </div>
  );
}

function ProofRow({ pill, text }: { pill: React.ReactNode; text: string }) {
  return (
    <div className="border-border/60 bg-card/60 flex items-center gap-3 rounded-xl border px-4 py-3 backdrop-blur-sm">
      {pill}
      <span className="text-muted-foreground text-meta">{text}</span>
    </div>
  );
}
