import { Dialog, DialogContent } from "@/components/ui/dialog";

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: "Go",
    rows: [
      [["⌘", "K"], "Search machines and actions"],
      [["n"], "New task"],
      [["g", "f"], "Fleet view"],
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
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="label text-faint mb-2">{g.title}</h3>
              <ul className="divide-border/60 divide-y">
                {g.rows.map(([keys, what]) => (
                  <li key={what} className="flex items-center justify-between gap-4 py-1.5">
                    <span className="text-foreground text-meta">{what}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {keys.map((k, i) => (
                        <kbd key={i} className="text-muted-foreground bg-muted min-w-6 rounded px-1.5 py-0.5 text-center font-sans text-micro">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
