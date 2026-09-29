import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, KeyRound, Plus, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { api, type ApiKeyRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { StaggerItem, Swap } from "@/components/ui/swap";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/* ─────────────── shared list furniture (also used by Users, Sessions, AuditLog) ─────────────── */

/** Two or three shimmering rows shaped like the list they stand in for. */
export function ListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <ul className={cn("divide-y", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-3.5 py-3">
          <Bar className="size-4 rounded" />
          <Bar className={cn("h-3", i % 2 ? "w-36" : "w-28")} />
          <Bar className="ml-auto hidden h-2.5 w-40 sm:block" />
        </li>
      ))}
    </ul>
  );
}

/** Icon · one line · optional inline call to action, centred inside a dashed card. */
export function ListEmpty({ icon: Icon, title, line, action, className }: { icon: LucideIcon; title: string; line?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("m-3 flex flex-col items-center rounded-lg border border-dashed px-6 py-8 text-center", className)}>
      <Icon className="text-muted-foreground size-5" aria-hidden />
      <p className="text-foreground mt-2.5 text-meta font-medium">{title}</p>
      {line && <p className="text-muted-foreground mt-0.5 max-w-sm text-meta">{line}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Copy → Check with the icon swapping in place and the label kept to a fixed width. */
export function CopyButton({ copied, onClick, size = "sm", className, ...props }: { copied: boolean; onClick: () => void; size?: "sm" | "xs" | "icon" | "icon-sm" } & Omit<React.ComponentProps<typeof Button>, "onClick" | "size" | "children">) {
  const still = useReducedMotion();
  const iconOnly = size === "icon" || size === "icon-sm";
  return (
    <Button size={size} variant="outline" onClick={onClick} className={cn(!iconOnly && "min-w-[5.25rem]", className)} aria-label={iconOnly ? (copied ? "Copied" : "Copy") : undefined} {...props}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "ok" : "copy"}
          initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          transition={{ type: "spring", stiffness: 600, damping: 30 }}
          className="inline-flex"
        >
          {copied ? <Check className="text-ok size-4" /> : <Copy className="size-4" />}
        </motion.span>
      </AnimatePresence>
      {!iconOnly && (copied ? "Copied" : "Copy")}
    </Button>
  );
}

/**
 * A secret shown exactly once. Springs in, the border flashes --live for a beat so the eye lands on
 * it, and the Copy button confirms in place. Reduced motion: plain fade, no flash.
 */
export function FreshTokenCard({ token, onDone, title, footer }: { token: string; onDone: () => void; title: React.ReactNode; footer?: React.ReactNode }) {
  const still = useReducedMotion();
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy — select it and copy it manually");
    }
  };
  return (
    <motion.div
      initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="bg-card raised relative mb-3 rounded-xl p-4"
    >
      {!still && (
        <motion.span
          aria-hidden
          className="ring-live pointer-events-none absolute -inset-px rounded-xl ring-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.8, 0] }}
          transition={{ duration: 1.1, delay: 0.15, times: [0, 0.3, 1], ease: "easeOut" }}
        />
      )}
      <p className="text-foreground text-meta font-medium">{title}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="bg-muted text-foreground min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 font-mono text-code select-all">{token}</code>
        <CopyButton copied={copied} onClick={() => void copy()} />
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      {footer && <p className="text-muted-foreground mt-2 text-micro">{footer}</p>}
    </motion.div>
  );
}

/* ───────────────────────────────────────── API keys ───────────────────────────────────────── */

/**
 * Personal API keys — what an IDE (Cursor, Claude Code…) or a CI job presents to /mcp and the JSON
 * routes as `Authorization: Bearer asb_…`. Shown once at creation; the server keeps only a hash.
 */
export function ApiKeys() {
  const [keys, setKeys] = React.useState<ApiKeyRow[] | null>(null);
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [fresh, setFresh] = React.useState<{ token: string; name: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const load = React.useCallback(() => api.apiKeys().then((r) => setKeys(r.keys)).catch(() => setKeys([])), []);
  React.useEffect(() => void load(), [load]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const k = await api.createApiKey(name.trim() || "key");
      setFresh({ token: k.token, name: name.trim() || "key" });
      setName("");
      void load();
    } catch (e) {
      toast.error("Could not create the key", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCreating(false);
    }
  };
  const revoke = async (k: ApiKeyRow) => {
    try {
      await api.revokeApiKey(k.id);
      setKeys((prev) => prev?.filter((x) => x.id !== k.id) ?? prev);
      toast.success(`Revoked ${k.name}`);
      void load();
    } catch (e) {
      toast.error("Could not revoke", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const active = (keys ?? []).filter((k) => !k.revoked_at);
  const state = keys === null ? "loading" : active.length === 0 ? "empty" : "list";

  return (
    <section aria-labelledby="keys-h" className="scroll-mt-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 id="keys-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          API keys
        </h2>
        <span className="text-muted-foreground text-meta">for Cursor, Claude Code, CI — the MCP endpoint</span>
      </div>

      <AnimatePresence initial={false}>
        {fresh && (
          <FreshTokenCard
            key="fresh"
            token={fresh.token}
            onDone={() => setFresh(null)}
            title="Copy your new key now — it will not be shown again."
            footer={
              <>
                MCP: <code className="font-mono">https://{location.host}/mcp</code> with header <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>
              </>
            }
          />
        )}
      </AnimatePresence>

      <div className="bg-card divide-y rounded-xl border shadow-e1">
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={2} />
          ) : state === "empty" ? (
            <ListEmpty
              icon={KeyRound}
              title="No keys yet"
              line="Create one to connect an IDE or a script."
              action={
                <Button size="sm" variant="outline" onClick={() => inputRef.current?.focus()}>
                  <Plus />
                  Name your first key
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              <AnimatePresence initial={false}>
                {active.map((k, i) => (
                  <motion.li key={k.id} layout exit={{ opacity: 0, height: 0, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }} className="overflow-hidden">
                    <StaggerItem index={i} className="flex items-center gap-3 px-3.5 py-2.5">
                      <KeyRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
                      <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">{k.name}</span>
                      <span className="stamp text-muted-foreground shrink-0">{k.prefix}…</span>
                      <span className="text-faint hidden shrink-0 text-micro sm:inline">{k.last_used_at && Number.isFinite(Date.parse(k.last_used_at)) ? `used ${fmtAgo(Date.parse(k.last_used_at) / 1000)}` : "never used"}</span>
                      <ArmButton size="icon-sm" variant="ghost" icon={<Trash2 />} label={`Revoke ${k.name}`} armedLabel="Revoke?" onConfirm={() => revoke(k)} className="text-muted-foreground hover:text-destructive" />
                    </StaggerItem>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Swap>
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Name this key — e.g. Cursor on laptop"
            aria-label="Key name"
            className="placeholder:text-muted-foreground text-foreground h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-meta outline-none"
          />
          <Button size="sm" variant="outline" onClick={() => void create()} loading={creating}>
            <Plus />
            New key
          </Button>
        </div>
      </div>
    </section>
  );
}
