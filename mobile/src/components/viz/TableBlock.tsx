import React from "react";
import { ScrollView, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { cellNumber, type ParsedTable } from "@/lib/viz";
import { T } from "../ui/AppText";
import { MiniAction } from "./VizFrame";

const ROW_CAP = 40;
const MIN_COL = 72;
const MAX_COL = 220;

/**
 * GFM / csv / tsv table: horizontally scrollable grid with hairline rows. Numeric columns
 * right-align (or follow the explicit alignment row). Capped at 40 rows with "…more".
 * `renderCell` lets the markdown layer render inline markup inside GFM cells.
 */
export function TableBlock({ table, renderCell }: { table: ParsedTable; renderCell?: (text: string) => React.ReactNode }) {
  const { palette } = useTheme();
  const [all, setAll] = React.useState(false);
  const { head, rows, align } = table;
  const cols = head.length;

  const colMeta = React.useMemo(() => {
    const out: { width: number; right: boolean; center: boolean }[] = [];
    for (let c = 0; c < cols; c++) {
      const texts = [head[c] ?? "", ...rows.slice(0, 60).map((r) => r[c] ?? "")];
      const longest = texts.reduce((m, t) => Math.max(m, t.length), 0);
      const width = Math.max(MIN_COL, Math.min(MAX_COL, longest * 7.5 + 20));
      const body = rows.map((r) => (r[c] ?? "").trim()).filter(Boolean);
      const numeric = body.length > 0 && body.every((t) => cellNumber(t) !== null);
      const a = align?.[c];
      out.push({ width, right: a === "right" || (a === undefined && numeric), center: a === "center" });
    }
    return out;
  }, [head, rows, align, cols]);

  const shown = all ? rows : rows.slice(0, ROW_CAP);
  const hidden = rows.length - shown.length;

  const cell = (text: string, c: number, headRow: boolean) => {
    const m = colMeta[c];
    const textAlign = m.center ? "center" : m.right ? "right" : "left";
    const content =
      renderCell && !headRow ? (
        renderCell(text)
      ) : (
        <T variant="meta" weight={headRow ? "medium" : "regular"} tone={headRow ? "muted" : "default"} selectable style={{ textAlign, fontVariant: m.right ? ["tabular-nums"] : undefined }}>
          {text}
        </T>
      );
    return (
      <View key={c} style={{ width: m.width, paddingHorizontal: 8, paddingVertical: 6, alignItems: m.center ? "center" : m.right ? "flex-end" : "flex-start" }}>
        {content}
      </View>
    );
  };

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
        <View>
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: palette.lineStrong }}>
            {head.map((h, c) => cell(h, c, true))}
          </View>
          {shown.map((r, i) => (
            <View key={i} style={{ flexDirection: "row", borderBottomWidth: i < shown.length - 1 ? 1 : 0, borderBottomColor: palette.border }}>
              {r.map((t, c) => cell(t, c, false))}
            </View>
          ))}
        </View>
      </ScrollView>
      {hidden > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8 }}>
          <T variant="micro" tone="faint">
            …{hidden} more rows
          </T>
          <MiniAction label="Show all" onPress={() => setAll(true)} />
        </View>
      ) : null}
    </View>
  );
}
