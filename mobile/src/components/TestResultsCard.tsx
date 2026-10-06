import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import type { TestFile, TestReport, TestStatus } from "@/lib/testReport";
import { T } from "./ui/AppText";
import { Icon, type IconName } from "./ui/Icon";
import { PressScale } from "@/components/motion";

/**
 * A test run as a result card (mirrors web/src/components/thread/TestResultsCard.tsx): summary
 * chips (passed / failed / skipped · duration · runner), then each file as a collapsible group of
 * cases. Failed files open by default; passing ones stay folded so a green run is one glance. The
 * "raw" toggle keeps the terminal text one tap away.
 */
export function TestResultsCard({ report, onRaw, rawOpen }: { report: TestReport; onRaw?: () => void; rawOpen?: boolean }) {
  const { palette } = useTheme();
  const total = report.passed + report.failed + report.skipped;
  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, backgroundColor: palette.card, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Chip status="pass" n={report.passed} label="passed" />
        {report.failed > 0 ? <Chip status="fail" n={report.failed} label="failed" /> : null}
        {report.skipped > 0 ? <Chip status="skip" n={report.skipped} label="skipped" /> : null}
        <View style={{ flex: 1, minWidth: 8 }} />
        {report.durationMs != null ? (
          <T variant="micro" tone="muted" mono>
            {fmtMs(report.durationMs)}
          </T>
        ) : null}
        <T variant="micro" tone="faint" weight="medium">
          {report.runner}
        </T>
        {onRaw ? (
          <PressScale onPress={onRaw} hitSlop={8}>
            <T variant="micro" tone="muted" style={{ textDecorationLine: "underline" }}>
              {rawOpen ? "hide raw" : "raw"}
            </T>
          </PressScale>
        ) : null}
      </View>
      {report.files.length > 0 ? (
        report.files.map((f, i) => (
          <FileGroup key={`${i}-${f.name}`} file={f} last={i === report.files.length - 1} defaultOpen={f.status === "fail" || report.files.length === 1} />
        ))
      ) : (
        <T variant="meta" tone="muted" style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          {total} {total === 1 ? "test" : "tests"} — the runner printed only a summary.
        </T>
      )}
    </View>
  );
}

function statusColor(status: TestStatus, palette: ReturnType<typeof useTheme>["palette"]): string {
  return status === "pass" ? palette.ok : status === "fail" ? palette.destructive : palette.attentionText;
}

function Chip({ status, n, label }: { status: TestStatus; n: number; label: string }) {
  const { palette } = useTheme();
  const color = statusColor(status, palette);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: `${color}1a` }}>
      <StatusDot status={status} />
      <T variant="micro" weight="medium" style={{ color }}>
        {n} {label}
      </T>
    </View>
  );
}

function FileGroup({ file, defaultOpen, last }: { file: TestFile; defaultOpen: boolean; last: boolean }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  const fails = file.tests.filter((t) => t.status === "fail").length;
  const count = file.tests.length || file.total || 0;
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: palette.border }}>
      <PressScale
        onPress={() => setOpen((v) => !v)}
        disabled={file.tests.length === 0}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={13} color={file.tests.length ? palette.mutedForeground : palette.border} />
        <StatusDot status={file.status} />
        <T variant="meta" mono numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, minWidth: 0 }}>
          {file.name}
        </T>
        <T variant="micro" tone="muted" mono style={{ flexShrink: 0 }}>
          {fails > 0 ? `${fails} failing · ` : ""}
          {count} {count === 1 ? "test" : "tests"}
        </T>
      </PressScale>
      {open && file.tests.length > 0 ? (
        <View>
          {file.tests.map((t, i) => (
            <View key={`${i}-${t.name}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 36, paddingRight: 12, paddingVertical: 5, borderTopWidth: 1, borderTopColor: palette.border }}>
              <StatusDot status={t.status} small />
              <T variant="meta" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                {t.name}
              </T>
              {t.ms != null ? (
                <T variant="micro" mono tone={t.status === "fail" ? "destructive" : "muted"} style={{ flexShrink: 0 }}>
                  {fmtMs(t.ms)}
                </T>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StatusDot({ status, small }: { status: TestStatus; small?: boolean }) {
  const { palette } = useTheme();
  const color = statusColor(status, palette);
  const size = small ? 14 : 16;
  const icon: IconName = status === "pass" ? "check" : status === "fail" ? "x" : "circle";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: color, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Icon name={icon} size={small ? 8 : 9} color={color} />
    </View>
  );
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
