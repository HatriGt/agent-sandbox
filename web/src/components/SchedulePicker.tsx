import * as React from "react";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * A schedule in plain words — "Weekdays at 02:00" — that reads and writes a cron string underneath.
 * Anything the picker can't express stays as raw cron ("Custom"), so nothing a user typed is lost.
 */

type Freq = "minutes" | "hourly" | "daily" | "weekdays" | "weekly" | "custom";
const FREQ: { value: Freq; label: string }[] = [
  { value: "minutes", label: "Every few min" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STEPS = [5, 10, 15, 30];

type Parsed = { freq: Freq; step: number; hour: number; minute: number; day: number };

function parse(cron: string): Parsed {
  const base: Parsed = { freq: "custom", step: 30, hour: 9, minute: 0, day: 1 };
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return base;
  const [m, h, dom, mon, dow] = p;
  const num = (s: string) => (/^\d{1,2}$/.test(s) ? Number(s) : null);
  const stepM = m.match(/^\*\/(\d+)$/);
  if (stepM && h === "*" && dom === "*" && mon === "*" && dow === "*") return { ...base, freq: "minutes", step: Number(stepM[1]) };
  const mm = num(m);
  if (mm === null || dom !== "*" || mon !== "*") return base;
  if (h === "*") return { ...base, freq: "hourly", minute: mm };
  const hh = num(h);
  if (hh === null) return base;
  if (dow === "*") return { ...base, freq: "daily", hour: hh, minute: mm };
  if (dow === "1-5") return { ...base, freq: "weekdays", hour: hh, minute: mm };
  const d = num(dow);
  if (d !== null && d <= 6) return { ...base, freq: "weekly", hour: hh, minute: mm, day: d };
  return base;
}

function build(s: Parsed): string {
  switch (s.freq) {
    case "minutes":
      return `*/${s.step} * * * *`;
    case "hourly":
      return `${s.minute} * * * *`;
    case "daily":
      return `${s.minute} ${s.hour} * * *`;
    case "weekdays":
      return `${s.minute} ${s.hour} * * 1-5`;
    case "weekly":
      return `${s.minute} ${s.hour} * * ${s.day}`;
    default:
      return "";
  }
}

const two = (n: number) => String(n).padStart(2, "0");

/** "Weekdays at 02:00" — what the cron means, in words. Empty for cron the picker can't read. */
export function describeCron(cron: string): string {
  const s = parse(cron);
  const at = `${two(s.hour)}:${two(s.minute)}`;
  switch (s.freq) {
    case "minutes":
      return `Every ${s.step} minutes`;
    case "hourly":
      return s.minute ? `Every hour at :${two(s.minute)}` : "Every hour";
    case "daily":
      return `Every day at ${at}`;
    case "weekdays":
      return `Weekdays at ${at}`;
    case "weekly":
      return `Every ${DAYS[s.day]} at ${at}`;
    default:
      return "";
  }
}

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
})();

const field = "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-meta outline-none focus-visible:ring-[3px]";

export function SchedulePicker({ cron, timezone, onChange }: { cron: string; timezone: string; onChange: (patch: { cron?: string; timezone?: string }) => void }) {
  const parsed = parse(cron);
  // "Custom" is sticky once chosen, so a cron that happens to be readable still shows the raw field.
  const [custom, setCustom] = React.useState(parsed.freq === "custom");
  const s: Parsed = custom ? { ...parsed, freq: "custom" } : parsed;
  const update = (patch: Partial<Parsed>) => onChange({ cron: build({ ...parsed, ...patch }) });
  const pick = (f: Freq) => {
    if (f === "custom") return setCustom(true);
    setCustom(false);
    update({ freq: f, ...(parsed.freq === "custom" ? { hour: 9, minute: 0 } : {}) });
  };
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = ZONES.length ? Array.from(new Set([localZone, "UTC", ...ZONES])) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented<Freq> ariaLabel="How often" value={s.freq} onChange={pick} options={FREQ} />
        <button type="button" onClick={() => (custom ? pick(parsed.freq === "custom" ? "daily" : parsed.freq) : pick("custom"))} className={cn("cursor-pointer text-micro underline-offset-2 hover:underline", custom ? "text-foreground" : "text-muted-foreground")}>
          {custom ? "Back to simple" : "Cron instead"}
        </button>
      </div>

      {s.freq === "custom" ? (
        <label className="block">
          <span className="text-faint mb-1 block text-micro">min hour day month weekday</span>
          <input className={cn(field, "w-full font-mono")} value={cron} onChange={(e) => onChange({ cron: e.target.value })} placeholder="0 2 * * 1-5" />
        </label>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-meta">
          {s.freq === "minutes" && (
            <>
              <span className="text-muted-foreground">every</span>
              <select className={field} value={STEPS.includes(s.step) ? s.step : 30} onChange={(e) => update({ step: Number(e.target.value) })}>
                {STEPS.map((n) => (
                  <option key={n} value={n}>
                    {n} min
                  </option>
                ))}
              </select>
            </>
          )}
          {s.freq === "hourly" && (
            <>
              <span className="text-muted-foreground">at minute</span>
              <select className={field} value={s.minute} onChange={(e) => update({ minute: Number(e.target.value) })}>
                {[0, 15, 30, 45].map((n) => (
                  <option key={n} value={n}>
                    :{two(n)}
                  </option>
                ))}
              </select>
            </>
          )}
          {s.freq === "weekly" && (
            <select className={field} value={s.day} onChange={(e) => update({ day: Number(e.target.value) })} aria-label="Day of week">
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {(s.freq === "daily" || s.freq === "weekdays" || s.freq === "weekly") && (
            <>
              <span className="text-muted-foreground">at</span>
              <input
                type="time"
                className={cn(field, "tabular-nums")}
                value={`${two(s.hour)}:${two(s.minute)}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (!Number.isNaN(h) && !Number.isNaN(m)) update({ hour: h, minute: m });
                }}
              />
            </>
          )}
          {s.freq !== "minutes" && (
            <>
              <span className="text-muted-foreground">in</span>
              {zones ? (
                <select className={cn(field, "max-w-[14rem]")} value={timezone || localZone} onChange={(e) => onChange({ timezone: e.target.value })} aria-label="Timezone">
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z === localZone ? `${z} (yours)` : z}
                    </option>
                  ))}
                </select>
              ) : (
                <input className={cn(field, "w-44")} value={timezone} onChange={(e) => onChange({ timezone: e.target.value })} placeholder={localZone} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
