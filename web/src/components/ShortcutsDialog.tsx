import { Dialog, DialogContent } from "@/components/ui/dialog";
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
      <DialogContent title="Keyboard shortcuts" className="max-w-md">
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
                      <StaggerItem index={before + ri} cap={16} className="flex items-center justify-between gap-4 py-1.5">
                        <span className="text-foreground text-meta">{what}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {keys.map((k, i) => (
                            // A raised keycap: light face, a heavier bottom edge for the "key" read.
                            <kbd key={i} className="text-muted-foreground bg-muted border-border min-w-6 rounded-md border border-b-2 px-1.5 py-0.5 text-center font-sans text-micro leading-4">
                              {k}
                            </kbd>
                          ))}
                        </span>
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
