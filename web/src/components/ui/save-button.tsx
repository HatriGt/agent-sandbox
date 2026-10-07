import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Save → (spinner) → Saved at one fixed width: the tick pops in beside the label and the label
 * crossfades, so the button never changes size mid-request. Shared by every settings form.
 */
export function SaveButton({ onClick, saving, saved, disabled, label = "Save", className }: { onClick: () => void; saving: boolean; saved: boolean; disabled?: boolean; label?: string; className?: string }) {
  const still = useReducedMotion();
  return (
    <Button size="sm" onClick={onClick} loading={saving} disabled={disabled && !saved} className={cn("min-w-[5.5rem]", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        {saved && (
          <motion.span
            key="tick"
            initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
            className="inline-flex"
          >
            <Check className="size-4" />
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={saved ? "saved" : "save"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="inline-block">
          {saved ? "Saved" : label}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}
