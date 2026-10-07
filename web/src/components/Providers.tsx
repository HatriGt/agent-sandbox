import * as React from "react";
import { DataTable, MetaLine, StatusDot, type Column } from "@/components/ui/data-table";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ProviderKind, type ProvidersResponse, type ProviderView } from "@/lib/api";
import { getMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/ui/settings";
import { Bar } from "@/components/thread/Skeletons";
import { Collapse } from "@/components/ui/collapse";
import { Swap } from "@/components/ui/swap";

const inputCls =
  "text-foreground placeholder:text-muted-foreground bg-muted focus:ring-ring h-9 rounded-md px-3 text-meta outline-none focus:ring-2";

const BASE_HINT: Record<ProviderKind, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  "openai-compatible": "https://my-endpoint.example.com/v1",
  ollama: "http://my-gpu-box:11434",
  ccproxy: "https://ccproxy.example.com",
};

const DRIVER_LABEL: Record<string, string> = { claude: "Claude Code", omp: "oh-my-pi", codex: "Codex CLI", opencode: "OpenCode" };

/** Shared cache so the composer's model picker and this page read one fetch. */
let cache: ProvidersResponse | null = null;
const listeners = new Set<(r: ProvidersResponse) => void>();
function publish(r: ProvidersResponse) {
  cache = r;
  for (const l of listeners) l(r);
}
export function useProviders(): ProvidersResponse | null {
  const [r, setR] = React.useState<ProvidersResponse | null>(cache);
  React.useEffect(() => {
    listeners.add(setR);
    const ctrl = new AbortController();
    api.providers(ctrl.signal).then(publish).catch(() => {});
    return () => {
      listeners.delete(setR);
      ctrl.abort();
    };
  }, []);
  return r;
}

/**
 * Model providers: where models come from — your own Anthropic or OpenAI key, any
 * OpenAI-compatible endpoint, a local Ollama, or a ccproxy. Keys are sealed on the server and only
 * ever shown masked. A thread started on a provider gets that endpoint in its egress allowlist.
 */
export function Providers() {
  const data = useProviders();
  const [adding, setAdding] = React.useState(false);
  const saas = getMe()?.mode === "saas";
  return (
    <SettingsSection
      id="providers"
      title="Model providers"
      meta="your keys · any endpoint · local models"
      actions={
        !adding ? (
          <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add provider
          </Button>
        ) : undefined
      }
    >
      <Swap state={data ? "list" : "loading"}>
        {!data ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
            <Bar className="h-12 w-full rounded-lg" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Collapse open={data.providers.length === 0 && !adding}>
              <p className="text-muted-foreground text-micro">No providers yet — runs use the deployment's default model access.</p>
            </Collapse>
            {data.providers.length > 0 && (
              <DataTable
                aria-label="Model providers"
                rows={data.providers}
                columns={PROVIDER_COLUMNS}
                rowKey={(p) => p.id}
                minWidth="min-w-[34rem]"
                search={data.providers.length > 8 ? { placeholder: "Search providers", text: (p) => `${p.label} ${p.kind} ${p.baseUrl} ${p.drivers.join(" ")}` } : undefined}
                actions={(p) => <ProviderActions p={p} />}
              />
            )}
            <Collapse open={adding}>
              <ProviderForm kinds={data.kinds} onDone={() => setAdding(false)} />
            </Collapse>
            {!saas && <p className="text-faint mt-1 text-micro">{data.cliLoginPolicy}</p>}
          </div>
        )}
      </Swap>
    </SettingsSection>
  );
}

const PROVIDER_COLUMNS: Column<ProviderView>[] = [
  {
    id: "label",
    header: "Provider",
    primary: true,
    sort: (p) => p.label,
    cell: (p) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{p.label}</span>
        <span className="text-muted-foreground truncate font-mono text-micro font-normal" title={p.baseUrl}>
          {p.baseUrl}
        </span>
      </span>
    ),
  },
  {
    id: "key",
    header: "Key",
    width: "w-36",
    hideBelow: "sm",
    sort: (p) => (p.apiKeyMasked ? 0 : 1),
    cell: (p) => (p.apiKeyMasked ? <span className="stamp text-muted-foreground truncate">{p.apiKeyMasked}</span> : <StatusDot tone="muted">no key</StatusDot>),
  },
  {
    id: "models",
    header: "Models",
    width: "w-28",
    sort: (p) => p.models?.length ?? -1,
    cell: (p) => (p.models ? <span className="text-muted-foreground text-micro tabular-nums">{`${p.models.length} model${p.models.length === 1 ? "" : "s"}`}</span> : <StatusDot tone="attention">not fetched</StatusDot>),
  },
  {
    id: "drivers",
    header: "Runs",
    width: "w-40",
    hideBelow: "md",
    sort: (p) => p.drivers.length,
    cell: (p) => <MetaLine parts={p.drivers.length ? p.drivers.map((d) => DRIVER_LABEL[d] ?? d) : ["no driver"]} />,
  },
];

function ProviderActions({ p }: { p: ProviderView }) {
  const [busy, setBusy] = React.useState<"models" | "del" | null>(null);
  const refresh = async () => {
    setBusy("models");
    try {
      const r = await api.providerModels(p.id, true);
      if (r.error) toast.error("Could not list models", { description: r.error });
      else toast.success(`${r.models.length} model${r.models.length === 1 ? "" : "s"}`);
      publish(await api.providers());
    } finally {
      setBusy(null);
    }
  };
  const del = async () => {
    setBusy("del");
    try {
      publish(await api.deleteProvider(p.id));
    } catch (e) {
      toast.error("Could not remove", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <span className="inline-flex items-center gap-0.5">
      <Button size="xs" variant="ghost" onClick={() => void refresh()} disabled={busy !== null} loading={busy === "models"} aria-label={`Refresh models for ${p.label}`}>
        <RefreshCw className="size-3.5" />
      </Button>
      <Button size="xs" variant="ghost" onClick={() => void del()} disabled={busy !== null} loading={busy === "del"} aria-label={`Remove ${p.label}`}>
        <Trash2 className="size-3.5" />
      </Button>
    </span>
  );
}

function ProviderForm({ kinds, onDone }: { kinds: ProvidersResponse["kinds"]; onDone: () => void }) {
  const [kind, setKind] = React.useState<ProviderKind>("anthropic");
  const [label, setLabel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.saveProvider({ kind, ...(label ? { label } : {}), ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}) });
      publish(r);
      // Fetch the model list right away so the composer picker has it.
      void api.providerModels(r.saved).then(() => api.providers().then(publish)).catch(() => {});
      onDone();
    } catch (err) {
      toast.error("Could not save", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  const kindInfo = kinds.find((k) => k.id === kind);
  return (
    <form onSubmit={(e) => void save(e)} className="border-ring bg-card flex flex-col gap-2 rounded-lg border p-3">
      <select value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)} className={inputCls} aria-label="Provider kind">
        {kinds.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kindInfo?.label ?? "Label"} className={inputCls} aria-label="Label" />
      <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={BASE_HINT[kind]} spellCheck={false} className={`${inputCls} font-mono`} aria-label="Base URL" />
      <input
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={kind === "ollama" ? "API key (optional)" : "API key"}
        spellCheck={false}
        className={`${inputCls} font-mono`}
        aria-label="API key"
      />
      <span className="text-faint text-micro">Runs on: {kindInfo?.drivers.map((d) => DRIVER_LABEL[d] ?? d).join(", ") || "—"}. The endpoint is added to the run's egress allowlist.</span>
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button size="xs" type="submit" loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
