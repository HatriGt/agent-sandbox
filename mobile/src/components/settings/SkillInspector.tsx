// How the agent sees a skill — ported from web/src/components/skills/SkillInspector.tsx: the two ways
// it fires, its on/off status, where it lands in the sandbox, what it weighs, when it was saved.
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { PressScale } from "@/components/motion";
import * as Clipboard from "expo-clipboard";
import type { SkillView } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/Toggle";
import type { SkillFile } from "./skillImport";
import { byteLength, fmtKb, MAX_CONTENT } from "./SkillModel";
import { SettingsSection } from "@/components/ui/SettingsSection";

export function SkillInspector({
  name,
  description,
  content,
  files,
  saved,
  enabled,
  onToggle,
  toggling,
}: {
  name: string;
  description: string;
  content: string;
  files: SkillFile[];
  saved?: SkillView;
  enabled: boolean;
  onToggle?: (next: boolean) => void;
  toggling?: boolean;
}) {
  const { palette } = useTheme();
  const [copied, setCopied] = useState(false);
  const slug = name || "your-skill";
  const bodyBytes = byteLength(content);
  const total = bodyBytes + files.reduce((n, f) => n + byteLength(f.content), 0);
  const pct = Math.min(100, Math.round((content.length / MAX_CONTENT) * 100));
  const paths = useMemo(() => ["SKILL.md", ...files.map((f) => f.path).sort()], [files]);
  const box = { backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 10 } as const;
  const chip = { backgroundColor: palette.muted, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 } as const;
  const sandboxPath = `~/.claude/skills/${slug}/`;

  return (
    <View style={{ gap: 20, paddingBottom: 8 }}>
      <SettingsSection title="Fires when">
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <T variant="micro" mono style={chip}>
            /{slug}
          </T>
          <T variant="meta" tone="muted" style={{ flex: 1 }}>
            is typed in chat.
          </T>
        </View>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <T variant="micro" mono style={chip}>
            auto
          </T>
          {description.trim() ? (
            <T variant="meta" tone="muted" numberOfLines={4} style={{ flex: 1 }}>
              a task matches <T variant="meta">“{description.trim()}”</T>
            </T>
          ) : (
            <T variant="meta" tone="faint" style={{ flex: 1 }}>
              a task matches the description — write one above.
            </T>
          )}
        </View>
      </SettingsSection>

      {saved && onToggle ? (
        <SettingsSection title="Status">
          <View style={[box, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="meta" weight="medium">
                {enabled ? "On" : "Off"}
              </T>
              <T variant="micro" tone="muted">
                {enabled ? "Synced into every sandbox on its next turn." : "Kept here, not given to the agent."}
              </T>
            </View>
            <Toggle value={enabled} onValueChange={onToggle} disabled={toggling} accessibilityLabel={enabled ? "Turn off" : "Turn on"} />
          </View>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="In the sandbox"
        action={
          <PressScale
            scaleTo={0.9}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Copy path"
            onPress={() => {
              void Clipboard.setStringAsync(sandboxPath);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            <Icon name={copied ? "check" : "copy"} size={13} color={copied ? palette.ok : undefined} />
          </PressScale>
        }
      >
        <View style={box}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="folder" size={12} />
            <T variant="micro" mono tone="muted">
              {sandboxPath}
            </T>
          </View>
          <View style={{ marginTop: 6, paddingLeft: 18, gap: 3 }}>
            {paths.slice(0, 8).map((p) => (
              <T key={p} variant="micro" mono numberOfLines={1}>
                — {p}
              </T>
            ))}
            {paths.length > 8 ? (
              <T variant="micro" tone="faint">
                +{paths.length - 8} more
              </T>
            ) : null}
          </View>
        </View>
      </SettingsSection>

      <SettingsSection title="Size">
        <Fact label="SKILL.md" value={fmtKb(bodyBytes)} />
        {files.length > 0 ? <Fact label={`${files.length} supporting file${files.length === 1 ? "" : "s"}`} value={fmtKb(total - bodyBytes)} /> : null}
        <Fact label="Instructions" value={`${pct}% of limit`} danger={pct >= 90} />
        <View style={{ height: 4, borderRadius: 2, backgroundColor: palette.muted, overflow: "hidden", marginTop: 4 }}>
          <View style={{ height: "100%", width: `${Math.max(pct, content.length ? 1.5 : 0)}%`, backgroundColor: pct >= 90 ? palette.destructive : palette.mutedForeground, borderRadius: 2 }} />
        </View>
      </SettingsSection>

      {saved ? (
        <SettingsSection title="History">
          <Fact label="Last saved" value={ago(saved.updatedAt)} />
          <Fact label="Added" value={new Date(saved.addedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} />
        </SettingsSection>
      ) : null}
    </View>
  );
}


function Fact({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
      <T variant="meta" tone="muted">
        {label}
      </T>
      <T variant="meta" tone={danger ? "destructive" : "default"}>
        {value}
      </T>
    </View>
  );
}
