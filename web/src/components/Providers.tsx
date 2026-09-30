import * as React from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ProviderKind, type ProvidersResponse, type ProviderView } from "@/lib/api";
import { getMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/ui/settings";
import { Bar } from "@/components/thread/Skeletons";

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
      {!data ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
          <Bar className="h-12 w-full rounded-lg" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {data.providers.length === 0 && !adding && (
            <p className="text-muted-foreground text-micro">No providers yet — runs use the deployment's default model access.</p>
          )}
          {data.providers.map((p) => (
            <ProviderRow key={p.id} p={p} />
          ))}
          {adding && <ProviderForm kinds={data.kinds} onDone={() => setAdding(false)} />}
          {!saas && <p className="text-faint mt-1 text-micro">{data.cliLoginPolicy}</p>}
        </div>
      )}
    </SettingsSection>
  );
}

function ProviderRow({ p }: { p: ProviderView }) {
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
    <div className="border-border flex items-start gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-meta font-medium">{p.label}</div>
        <div className="text-muted-foreground truncate font-mono text-micro">{p.baseUrl}</div>
        <div className="text-faint mt-1 text-micro">
          {p.apiKeyMasked ? <span className="font-mono">{p.apiKeyMasked}</span> : "no key"} ·{" "}
          {p.models ? `${p.models.length} model${p.models.length === 1 ? "" : "s"}` : "models not fetched"} · runs {p.drivers.map((d) => DRIVER_LABEL[d] ?? d).join(", ") || "no driver"}
        </div>
      </div>
      <Button size="xs" variant="ghost" onClick={() => void refresh()} disabled={busy !== null} aria-label="Refresh models">
        {busy === "models" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      </Button>
      <Button size="xs" variant="ghost" onClick={() => void del()} disabled={busy !== null} aria-label="Remove provider">
        {busy === "del" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </Button>
    </div>
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
        <Button size="xs" type="submit" disabled={busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}
