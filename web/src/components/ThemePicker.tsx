import * as React from "react";
import { Check } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { THEMES, isThemeId, setTheme, useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The theme menu: five rows, each a three-tone swatch (rail, page, live), the name, and a check on
 * the current one. `children` is the trigger (a footer button or a rail icon). Switching is instant:
 * a theme changes a hundred times a day for some people and is not a moment for motion.
 */
export function ThemePicker({ children, side = "top", align = "end" }: { children: React.ReactElement; side?: "top" | "right" | "bottom" | "left"; align?: "start" | "center" | "end" }) {
  const current = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="min-w-[13.5rem]">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.id} onValueChange={(v) => isThemeId(v) && setTheme(v)}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id} className="gap-3" data-theme-option={t.id}>
              <Swatch theme={t} />
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate font-medium">{t.label}</span>
                <span className="text-faint truncate text-micro">{t.description}</span>
              </span>
              <Check className={cn("size-4", t.id === current.id ? "text-foreground" : "invisible")} aria-hidden />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Rail | page with a live dot, in the theme's own tones, so a row previews the theme before it is chosen. */
function Swatch({ theme }: { theme: Theme }) {
  const { background, sidebar, live } = theme.preview;
  return (
    <span className="ring-foreground/15 flex h-4 w-9 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-inset" aria-hidden>
      <span className="w-3" style={{ background: sidebar }} />
      <span className="flex flex-1 items-center justify-center" style={{ background }}>
        <span className="size-1.5 rounded-full" style={{ background: live }} />
      </span>
    </span>
  );
}
