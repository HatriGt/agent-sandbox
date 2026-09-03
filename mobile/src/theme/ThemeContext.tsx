import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { palettes, type Palette } from "./tokens";

export type ThemePref = "system" | "light" | "dark";

type ThemeCtx = {
  palette: Palette;
  dark: boolean;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
};

const Ctx = createContext<ThemeCtx>({
  palette: palettes.dark,
  dark: true,
  pref: "system",
  setPref: () => {},
});

const KEY = "asb-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("system");

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === "light" || v === "dark" || v === "system") setPrefState(v);
    });
  }, []);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    AsyncStorage.setItem(KEY, p).catch(() => {});
  };

  const dark = pref === "system" ? system !== "light" : pref === "dark";
  const value = useMemo(
    () => ({ palette: dark ? palettes.dark : palettes.light, dark, pref, setPref }),
    [dark, pref],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
