"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Tooltips: a 350ms first-hover delay (long enough not to flicker while the cursor crosses a rail),
 * then instant between neighbours for 300ms. The panel fades in over 120ms with a 2px slide from
 * the trigger side — no zoom, so it reads as a label appearing, not a popover launching. Dark mode
 * uses the popover surface with a hairline instead of a bright inverted pill.
 */
// The first tooltip waits 400ms; once one is open, moving to a neighbour within 300ms opens the next
// one at once (Radix marks it data-state="instant-open", and index.css gives only delayed-open an
// entry animation).
function TooltipProvider({
  delayDuration = 400,
  skipDelayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-2.5 py-1.5 text-meta text-balance",
          // Light: inverted pill. Dark: popover surface + hairline (a bright pill glares on a dark canvas).
          "bg-foreground text-background dark:bg-popover dark:text-popover-foreground dark:border dark:border-border dark:shadow-e2",
          // Entry motion lives in index.css (`[data-state=delayed-open]` only): 125ms fade from
          // scale 0.97 out of the Radix transform origin. An instant-open tooltip (the pointer moved
          // from a neighbour) and a closing one get no animation at all, so adjacent tips swap
          // without two of them overlapping.
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground dark:bg-popover dark:fill-popover dark:border-r dark:border-b dark:border-border" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/** A keyboard hint inside a tooltip: "Fleet view  g f". */
function TooltipKbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "ml-2 inline-flex items-center rounded border px-1 py-px font-sans text-micro tabular-nums",
        "border-background/25 text-background/70 dark:border-border dark:text-muted-foreground",
        className
      )}
    >
      {children}
    </kbd>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipKbd }
