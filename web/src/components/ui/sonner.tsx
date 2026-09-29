import * as React from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/** Matches Tailwind's `md` breakpoint; re-evaluates live so a resized window re-homes the stack. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  )
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const update = () => setDesktop(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return desktop
}

/**
 * The one toast stack. Bottom-right on desktop (out of the reading line, near where the cursor
 * rests), top-center on phones (the composer owns the bottom edge). The bottom offset clears the
 * thread composer so a toast never covers the send button. Colours come from the app tokens so
 * both themes match the surrounding cards; status icons carry the semantic tint.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const desktop = useIsDesktop()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position={desktop ? "bottom-right" : "top-center"}
      offset={desktop ? { bottom: 88, right: 16 } : { top: 12 }}
      mobileOffset={{ top: 12, left: 12, right: 12 }}
      duration={4000}
      closeButton
      expand={false}
      gap={8}
      icons={{
        success: <CircleCheckIcon className="text-ok size-4" />,
        info: <InfoIcon className="text-muted-foreground size-4" />,
        warning: <TriangleAlertIcon className="text-attention-text size-4" />,
        error: <OctagonXIcon className="text-destructive size-4" />,
        loading: <Loader2Icon className="text-muted-foreground size-4 animate-spin motion-reduce:animate-none" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "!bg-card !text-card-foreground !border-border !shadow-e3 !rounded-lg !text-meta !gap-2.5 !items-start !py-3 !px-3.5",
          title: "!font-medium !text-card-foreground",
          description: "!text-muted-foreground !text-micro",
          closeButton:
            "!bg-card !text-muted-foreground !border-border hover:!bg-muted hover:!text-foreground !transition-colors cursor-pointer",
          actionButton: "!bg-primary !text-primary-foreground !rounded-md !text-micro !font-medium cursor-pointer",
          cancelButton: "!bg-muted !text-foreground !rounded-md !text-micro cursor-pointer",
          icon: "!mt-0.5",
        },
        ...props.toastOptions,
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--card-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--card)",
          "--success-text": "var(--card-foreground)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--card)",
          "--error-text": "var(--card-foreground)",
          "--error-border": "var(--border)",
          "--warning-bg": "var(--card)",
          "--warning-text": "var(--card-foreground)",
          "--warning-border": "var(--border)",
          "--info-bg": "var(--card)",
          "--info-text": "var(--card-foreground)",
          "--info-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
