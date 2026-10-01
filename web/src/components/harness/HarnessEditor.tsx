import * as React from "react";
import type { AgentChoice, AgentId, ProviderView, SkillView } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/field";
import { Panel, PanelFooter } from "@/components/ui/settings";
import { Switch } from "@/components/ui/switch";
import { RULE_LABELS, bodyOf, type HarnessDraft } from "@/components/harness/model";

export function HarnessEditor({
  draft: initial,
  drivers,
  providers,
  skills,
  onSave,
  onCancel,
}: {
  draft: HarnessDraft;
  drivers: AgentChoice[];
  providers: ProviderView[];
  skills: SkillView[];
  onSave: (body: Record<string, unknown>, id?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const set = <K extends keyof HarnessDraft>(k: K, v: HarnessDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const provider = providers.find((p) => p.id === d.providerId);
  const toggleSkill = (name: string) => set("skills", d.skills.includes(name) ? d.skills.filter((s) => s !== name) : [...d.skills, name]);
  const nameError = !d.name.trim() ? "A name is required." : undefined;

  return (
    <Panel>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (nameError) return;
          setSaving(true);
          try {
            await onSave(bodyOf(d), d.id);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="flex flex-col gap-6 p-4 md:p-5">
          <h2 className="text-foreground text-h3 font-semibold">{d.id ? `Edit ${initial.name}` : "New harness"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={d.name && nameError}>
              {(w) => <Input {...w} value={d.name} maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder="Careful reviewer" />}
            </Field>
            <Field label="Description" optional>
              {(w) => <Input {...w} value={d.description} maxLength={300} onChange={(e) => set("description", e.target.value)} />}
            </Field>
          </div>

          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="text-foreground mb-2 text-meta font-medium">Driver & model</legend>
            <Field label="Driver" optional>
              {(w) => (
                <select {...w} className={inputClass} value={d.driver} onChange={(e) => set("driver", e.target.value as AgentId | "")}>
                  <option value="">Your default</option>
                  {drivers.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Provider" optional hint="Keys stay on the provider; a harness only points at it.">
              {(w) => (
                <select {...w} className={inputClass} value={d.providerId} onChange={(e) => setD((x) => ({ ...x, providerId: e.target.value, model: "" }))}>
                  <option value="">Controller default</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Model" optional>
              {(w) =>
                provider?.models?.length ? (
                  <select {...w} className={inputClass} value={d.model} onChange={(e) => set("model", e.target.value)}>
                    <option value="">Provider default</option>
                    {provider.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input {...w} mono value={d.model} onChange={(e) => set("model", e.target.value)} placeholder="default" />
                )
              }
            </Field>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-foreground mb-1 text-meta font-medium">Rules</legend>
            <p className="text-faint -mt-1 text-micro">Placed above the task as instructions. Verify on done is enforced by the controller.</p>
            {RULE_LABELS.map((r) => (
              <label key={r.key} className="flex cursor-pointer items-start gap-3 py-1">
                <Switch size="sm" className="mt-0.5" checked={d.rules[r.key]} onCheckedChange={(v) => set("rules", { ...d.rules, [r.key]: v })} aria-label={r.label} />
                <span className="min-w-0">
                  <span className="text-foreground block text-meta">{r.label}</span>
                  <span className="text-muted-foreground block text-micro">{r.line}</span>
                </span>
              </label>
            ))}
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <Field label="RULES.md" optional>
                {(w) => <textarea {...w} className={cn(inputClass, "h-28 py-2 font-mono text-micro")} value={d.rulesMd} maxLength={16384} onChange={(e) => set("rulesMd", e.target.value)} placeholder="House rules for this harness…" />}
              </Field>
              <Field label="Verify command" optional hint={d.rules.verifyOnDone ? "Runs in the sandbox; its exit code is the verdict." : "Used when Verify on done is on."}>
                {(w) => <textarea {...w} className={cn(inputClass, "h-28 py-2 font-mono text-micro")} value={d.verifyCommand} maxLength={4000} onChange={(e) => set("verifyCommand", e.target.value)} placeholder="npm test" />}
              </Field>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-foreground mb-1 text-meta font-medium">Skills</legend>
            <p className="text-faint -mt-1 text-micro">{d.skills.length ? "Only these are installed (disabled ones too)." : "None picked: the run gets your enabled skills."}</p>
            {skills.length ? (
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => {
                  const on = d.skills.includes(s.name);
                  return (
                    <button
                      key={s.name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleSkill(s.name)}
                      className={cn("h-7 rounded-md border px-2.5 text-micro transition-colors", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-micro">No skills in your library yet.</p>
            )}
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="text-foreground mb-2 text-meta font-medium">Egress</legend>
            <Field label="Extra hosts" optional hint="Hostnames only, one per line.">
              {(w) => <textarea {...w} className={cn(inputClass, "h-24 py-2 font-mono text-micro")} value={d.egress} onChange={(e) => set("egress", e.target.value)} placeholder={"registry.npmjs.org\napi.stripe.com"} />}
            </Field>
          </fieldset>
        </div>
        <PanelFooter className="justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!!nameError || saving}>
            {saving ? "Saving…" : d.id ? "Save" : "Create"}
          </Button>
        </PanelFooter>
      </form>
    </Panel>
  );
}
