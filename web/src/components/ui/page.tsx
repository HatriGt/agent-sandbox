import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/** A settled page: content rises 8px and fades in over ~300ms. Same curve everywhere so pages feel like one product. */
export function PageEnter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className={cn(className)}>
      {children}
    </motion.div>
  );
}
