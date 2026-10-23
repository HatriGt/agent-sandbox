import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Palette } from "./tokens";
import { parseThemePref, resolveTheme, themeOf, type Theme, type ThemePref } from "./themes";

export type { ThemePref } from "./themes";

type ThemeCtx = {
  palette: Palette;
  /** The resolved scheme, for the status bar and every light/dark fork. */
  dark: boolean;
  theme: Theme;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
};

const Ctx = createContext<ThemeCtx>({
  palette: themeOf("black").palette,
  dark: true,
  theme: themeOf("black"),
  pref: "system",
  setPref: () => {},
});

const KEY = "asb-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("system");

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      const p = parseThemePref(v);
      setPrefState(p);
      // A legacy "dark" is rewritten as "black" once, so the migration does not run on every launch.
      if (v !== null && v !== p) AsyncStorage.setItem(KEY, p).catch(() => {});
    });
  }, []);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    AsyncStorage.setItem(KEY, p).catch(() => {});
  };

  const theme = resolveTheme(pref, system === "light" ? "light" : "dark");
  const value = useMemo(() => ({ palette: theme.palette, dark: theme.scheme === "dark", theme, pref, setPref }), [theme, pref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
