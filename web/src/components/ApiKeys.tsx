import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ApiKeyRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { StaggerItem, Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { SecretReveal } from "@/components/ui/secret";
import { Panel, PanelFooter, SettingsSection } from "@/components/ui/settings";

/** `asb_ab12…` → `asb_ab12 •••• ••••` so the list reads as masked, not truncated. */
function masked(prefix: string) {
  return `${prefix} •••• ••••`;
}

/**
 * Personal API keys — what an IDE (Cursor, Claude Code…) or a CI job presents to /mcp and the JSON
 * routes as `Authorization: Bearer asb_…`. Shown once at creation; the server keeps only a hash, so
 * the list can only ever show the prefix.
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
      const label = name.trim() || "key";
      const k = await api.createApiKey(label);
      setFresh({ token: k.token, name: label });
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
      toast.success(`Revoked ${k.name}`, { description: "Anything still using it gets a 401 from now on." });
      void load();
    } catch (e) {
      toast.error("Could not revoke", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const active = (keys ?? []).filter((k) => !k.revoked_at);
  const state = keys === null ? "loading" : active.length === 0 ? "empty" : "list";

  return (
    <SettingsSection id="keys" title="API keys" meta={keys ? `${active.length} active` : undefined} purpose="What Cursor, Claude Code or a CI job presents to the MCP endpoint. Each key is shown once; only its prefix is kept.">
      <AnimatePresence initial={false}>
        {fresh && (
          <SecretReveal
            key="fresh"
            className="mb-3"
            value={fresh.token}
            onDone={() => setFresh(null)}
            title={
              <>
                Copy <span className="font-mono">{fresh.name}</span> now — it will not be shown again.
              </>
            }
            footer={
              <>
                MCP: <code className="font-mono">https://{location.host}/mcp</code> with header <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>
              </>
            }
          />
        )}
      </AnimatePresence>

      <Panel>
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={2} />
          ) : state === "empty" ? (
            <ListEmpty
              icon={KeyRound}
              title="No keys yet"
              line="A key lets an editor or a script start machines as you. Name one below."
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
                    <StaggerItem index={i} className="group flex items-center gap-3 px-3.5 py-2.5">
                      <KeyRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
                        <span className="text-foreground min-w-0 truncate text-meta font-medium">{k.name}</span>
                        <span className="stamp text-muted-foreground shrink-0">{masked(k.prefix)}</span>
                      </span>
                      <span className="text-faint hidden shrink-0 text-micro tabular-nums sm:inline">{k.last_used_at && Number.isFinite(Date.parse(k.last_used_at)) ? `used ${fmtAgo(Date.parse(k.last_used_at) / 1000)}` : "never used"}</span>
                      <ArmButton
                        size="icon-sm"
                        variant="ghost"
                        icon={<Trash2 />}
                        label={`Revoke ${k.name}`}
                        armedLabel="Revoke?"
                        onConfirm={() => revoke(k)}
                        className="text-muted-foreground hover:text-destructive sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:data-[armed=true]:opacity-100"
                      />
                    </StaggerItem>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Swap>
        <PanelFooter>
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
        </PanelFooter>
      </Panel>
    </SettingsSection>
  );
}
