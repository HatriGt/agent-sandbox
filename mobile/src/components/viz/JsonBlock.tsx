import React from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import type { JsonValue } from "@/lib/viz";
import { T } from "../ui/AppText";
import { Icon } from "../ui/Icon";
import { PressScale } from "@/components/motion";

const AUTO_OPEN_DEPTH = 2;
const MAX_CHILDREN = 200;

/** Collapsible JSON tree: objects/arrays beyond depth 2 start folded; arrays show their count. */
export function JsonBlock({ value }: { value: JsonValue }) {
  return (
    <View>
      <JsonNode name={null} value={value} depth={0} last />
    </View>
  );
}

function isContainer(v: JsonValue): v is JsonValue[] | { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null;
}

function summary(v: JsonValue[] | { [k: string]: JsonValue }): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  const n = Object.keys(v).length;
  return `{${n} ${n === 1 ? "key" : "keys"}}`;
}

function JsonNode({ name, value, depth, last }: { name: string | null; value: JsonValue; depth: number; last: boolean }) {
  const { palette } = useTheme();
  const [open, setOpen] = React.useState(depth < AUTO_OPEN_DEPTH);
  const indent = depth * 14;
  const key =
    name !== null ? (
      <T variant="code" mono style={{ color: palette.sleep }}>
        {name}
        <T variant="code" mono tone="faint">
          :{" "}
        </T>
      </T>
    ) : null;

  if (!isContainer(value)) {
    const color =
      typeof value === "string" ? palette.ok : typeof value === "number" ? palette.live : value === null ? palette.faint : palette.attentionText;
    const text = typeof value === "string" ? JSON.stringify(value) : String(value);
    return (
      <View style={{ flexDirection: "row", paddingLeft: indent, flexWrap: "wrap" }}>
        <T variant="code" mono selectable>
          {key}
          <T variant="code" mono selectable style={{ color }}>
            {text}
          </T>
          {!last ? (
            <T variant="code" mono tone="faint">
              ,
            </T>
          ) : null}
        </T>
      </View>
    );
  }

  const entries: [string | null, JsonValue][] = Array.isArray(value)
    ? value.map((v) => [null, v] as [string | null, JsonValue])
    : Object.entries(value);
  const shown = entries.slice(0, MAX_CHILDREN);
  const [openB, closeB] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];

  return (
    <View>
      <PressScale onPress={() => setOpen((o) => !o)} style={{ flexDirection: "row", alignItems: "center", paddingLeft: indent }} hitSlop={4}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} color={palette.faint} style={{ marginLeft: -14, width: 14 }} />
        <T variant="code" mono>
          {key}
          <T variant="code" mono tone="faint">
            {open ? openB : `${openB} ${summary(value)} ${closeB}${last ? "" : ","}`}
          </T>
        </T>
      </PressScale>
      {open ? (
        <View>
          {shown.map(([k, v], i) => (
            <JsonNode key={k ?? i} name={k} value={v} depth={depth + 1} last={i === entries.length - 1} />
          ))}
          {entries.length > shown.length ? (
            <T variant="micro" tone="faint" style={{ paddingLeft: indent + 14 }}>
              …{entries.length - shown.length} more
            </T>
          ) : null}
          <T variant="code" mono tone="faint" style={{ paddingLeft: indent }}>
            {closeB}
            {!last ? "," : ""}
          </T>
        </View>
      ) : null}
    </View>
  );
}
