// A schedule in plain words — "Weekdays at 09:00" — that reads and writes a cron string underneath.
// Parse/build mirror web/src/components/SchedulePicker.tsx; anything the picker can't express stays
// as raw cron ("Custom"), so nothing a user typed is lost.
import React from "react";
import { View } from "react-native";
import { T } from "@/components/ui/AppText";
import { Field } from "@/components/ui/Field";
import { Segmented } from "./Segmented";

type Freq = "minutes" | "hourly" | "daily" | "weekdays" | "weekly" | "custom";
const FREQ: { value: Freq; label: string }[] = [
  { value: "minutes", label: "Every few min" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom" },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STEPS = [5, 10, 15, 30];
const HOURS = [6, 7, 8, 9, 10, 12, 14, 17, 18, 20, 22, 0, 2];

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

export const deviceTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export function SchedulePicker({ cron, timezone, onChange }: { cron: string; timezone: string; onChange: (patch: { cron?: string; timezone?: string }) => void }) {
  const parsed = parse(cron);
  // `custom` is sticky once chosen so a half-typed cron doesn't flip the UI back to a preset.
  const [custom, setCustom] = React.useState(parsed.freq === "custom" && cron.trim() !== "");
  const freq: Freq = custom ? "custom" : parsed.freq === "custom" ? "weekdays" : parsed.freq;
  const update = (patch: Partial<Parsed>) => onChange({ cron: build({ ...parsed, freq, ...patch }) });
  const setFreq = (f: Freq) => {
    if (f === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    onChange({ cron: build({ ...parsed, freq: f }) });
  };
  React.useEffect(() => {
    // First mount with an empty cron: pick a sensible default so the preview is never blank.
    if (!cron.trim() && !custom) onChange({ cron: build({ ...parsed, freq: "weekdays" }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hourOpts = (parsed.freq !== "custom" && !HOURS.includes(parsed.hour) ? [...HOURS, parsed.hour] : HOURS)
    .slice()
    .sort((a, b) => a - b)
    .map((h) => ({ value: String(h), label: `${two(h)}:00` }));

  return (
    <View style={{ gap: 10 }}>
      <Segmented small value={freq} options={FREQ} onChange={setFreq} />
      {freq === "minutes" ? (
        <Segmented small value={String(parsed.step)} options={STEPS.map((s) => ({ value: String(s), label: `${s} min` }))} onChange={(v) => update({ step: Number(v) })} />
      ) : null}
      {freq === "weekly" ? (
        <Segmented small value={String(parsed.day)} options={DAYS.map((d, i) => ({ value: String(i), label: d }))} onChange={(v) => update({ day: Number(v) })} />
      ) : null}
      {freq === "daily" || freq === "weekdays" || freq === "weekly" ? (
        <Segmented small value={String(parsed.hour)} options={hourOpts} onChange={(v) => update({ hour: Number(v), minute: 0 })} />
      ) : null}
      {freq === "hourly" ? (
        <Segmented small value={String(parsed.minute)} options={[0, 15, 30, 45].map((m) => ({ value: String(m), label: `at :${two(m)}` }))} onChange={(v) => update({ minute: Number(v) })} />
      ) : null}
      {freq === "custom" ? (
        <Field
          mono
          label="Cron"
          value={cron}
          onChangeText={(t) => onChange({ cron: t })}
          placeholder="0 2 * * 1-5"
          autoCapitalize="none"
          autoCorrect={false}
          hint="minute hour day-of-month month day-of-week"
        />
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <T variant="meta" weight="medium">
          {describeCron(cron) || (cron.trim() ? "Custom schedule" : "No schedule yet")}
        </T>
        <T variant="micro" tone="faint">
          {timezone}
          {cron.trim() ? ` · ${cron}` : ""}
        </T>
      </View>
      <Field
        label="Time zone"
        value={timezone}
        onChangeText={(t) => onChange({ timezone: t })}
        placeholder={deviceTimezone()}
        autoCapitalize="none"
        autoCorrect={false}
        hint="IANA name, e.g. Europe/Berlin. Defaults to this device's zone."
      />
    </View>
  );
}
