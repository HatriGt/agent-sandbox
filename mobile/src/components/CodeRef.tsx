import React from "react";
import { useRouter } from "expo-router";
import { useTheme } from "@/theme/ThemeContext";
import { refLabel, type CodeRef } from "@/lib/code-refs";
import { T } from "./ui/AppText";

/**
 * Code references in agent markdown (`web/src/lib/viz.ts:42`, `[parseDag](viz-extra.ts:515)`) open
 * the box's file viewer at that line - web code-ref.tsx. Only inside a box thread: the box page
 * provides its session; everywhere else (skills, PR bodies) refs stay plain inline code.
 */
export const CodeRefSession = React.createContext<string | null>(null);

/** Symbol → ref bindings for the message being rendered (lib/code-refs `symbolRefs`). */
export const CodeRefSymbols = React.createContext<Map<string, CodeRef> | null>(null);

export function CodeRefLink({ refTo, text }: { refTo: CodeRef; text: string }) {
  const session = React.useContext(CodeRefSession);
  const router = useRouter();
  const { palette } = useTheme();
  if (!session) return null;
  return (
    <T
      variant="code"
      mono
      accessibilityRole="link"
      accessibilityHint={`Opens ${refLabel(refTo)}`}
      onPress={() =>
        router.push({
          pathname: "/files/[name]",
          params: { name: session, path: refTo.path, ...(refTo.line ? { line: String(refTo.line) } : {}) },
        })
      }
      style={{ backgroundColor: palette.muted, color: palette.live, textDecorationLine: "underline", textDecorationColor: palette.lineStrong }}
    >
      {text}
    </T>
  );
}
