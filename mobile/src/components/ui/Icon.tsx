import React from "react";
import Feather from "@expo/vector-icons/Feather";
import { useTheme } from "@/theme/ThemeContext";

export type IconName = React.ComponentProps<typeof Feather>["name"];

/** Feather icons — the same visual family as the web's lucide set. */
export function Icon({
  name,
  size = 16,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: object;
}) {
  const { palette } = useTheme();
  return <Feather name={name} size={size} color={color ?? palette.mutedForeground} style={style} />;
}

/** Tool name → icon, mirroring the web trace's iconography. */
export function toolIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (/(bash|shell|terminal|run|exec)/.test(n)) return "terminal";
  if (/(write|edit|notebookedit|multiedit)/.test(n)) return "edit-3";
  if (/read/.test(n)) return "file-text";
  if (/(grep|glob|search|find)/.test(n)) return "search";
  if (/(web|fetch|http|url)/.test(n)) return "globe";
  if (/todo|task|plan/.test(n)) return "check-square";
  if (/agent|delegate/.test(n)) return "cpu";
  if (/git|commit|push/.test(n)) return "git-branch";
  if (/output/.test(n)) return "align-left";
  return "tool";
}
