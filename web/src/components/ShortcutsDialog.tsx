import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { StaggerItem } from "@/components/ui/swap";

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: "Go",
    rows: [
      [["⌘", "K"], "Search machines and actions"],
      [["n"], "New task"],
      [["g", "f"], "Fleet view"],
      [["g", "h"], "History"],
      [["g", "s"], "Skills"],
      [["g", "a"], "Integrations"],
      [["j"], "Next machine"],
      [["k"], "Previous machine"],
    ],
  },
  {
    title: "Thread",
    rows: [
      [["/"], "Focus the composer"],
      [["↵"], "Send"],
      [["⇧", "↵"], "New line"],
      [["@"], "Mention a file"],
      [["esc"], "Cancel destroy · close panes"],
    ],
  },
  {
    title: "Anywhere",
    rows: [
      [["?"], "This list"],
      [["esc"], "Close"],
    ],
  },
];

/** `?` anywhere. The keys people forget, in the order they reach for them. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Opened by a keystroke: focus stays on the panel itself, not on the close button, so the
          first thing the eye meets isn't a focus ring around an X. Esc still closes. */}
      <DialogContent title="Keyboard shortcuts" className="max-w-md" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus?.(); }}>
        <div className="grid gap-5 pt-1">
          {GROUPS.map((g, gi) => {
            // Rows stagger across the whole dialog, not per group, so the list reads top to bottom.
            const before = GROUPS.slice(0, gi).reduce((n, x) => n + x.rows.length, 0);
            return (
              <section key={g.title}>
                <h3 className="label text-faint mb-2">{g.title}</h3>
                <ul className="divide-border/60 divide-y">
                  {g.rows.map(([keys, what], ri) => (
                    <li key={what}>
                      <StaggerItem index={before + ri} cap={16} className="flex h-8 items-center justify-between gap-4">
                        <span className="text-foreground text-meta">{what}</span>
                        <Kbd keys={keys} />
                      </StaggerItem>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
