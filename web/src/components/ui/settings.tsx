import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionNav } from "@/components/ui/section-nav";
import { cn } from "@/lib/utils";

/**
 * Every settings/admin page is the same shape: optional back link, one serif title with a one-line
 * purpose and the page's primary action on the right, then stacked sections. On xl screens a sticky
 * `SectionNav` follows the scroll (it hides itself under three sections). The shell owns the scroll
 * container so the nav's IntersectionObserver has the right root.
 */
export function SettingsPage({
  title,
  purpose,
  actions,
  back,
  children,
  width = "max-w-4xl",
}: {
  title: React.ReactNode;
  purpose?: React.ReactNode;
  actions?: React.ReactNode;
  /** `mobileOnly` hides the link at ≥md, where the sidebar already provides the way back. */
  back?: { label: string; onClick: () => void; mobileOnly?: boolean };
  children: React.ReactNode;
  width?: string;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} className="h-full min-w-0 overflow-y-auto">
      <div className={cn("mx-auto px-5 py-6 md:px-8 md:py-8", width, "xl:grid xl:max-w-5xl xl:grid-cols-[minmax(0,1fr)_10rem] xl:gap-x-12")}>
        <div className="hidden xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:block">
          <div className="sticky top-8 pt-[4.25rem]">
            <SectionNav scrollRef={scrollRef} />
          </div>
        </div>
        <div className="xl:col-start-1 xl:row-start-1">
          {back && (
            <Button variant="ghost" size="sm" onClick={back.onClick} className={cn("-ml-2 mb-3", back.mobileOnly && "md:hidden")}>
              <ArrowLeft className="size-4" />
              {back.label}
            </Button>
          )}
          <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em]">{title}</h1>
              {purpose && <p className="text-muted-foreground mt-1 text-meta">{purpose}</p>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
          </header>
        </div>
        <div className="flex flex-col gap-11 xl:col-start-1 xl:row-start-2">{children}</div>
      </div>
    </div>
  );
}

/**
 * One titled block: `<section aria-labelledby>` (so SectionNav finds it), a heading row with an
 * inline fact (`meta`) and the section's controls on the right, then the one-line purpose. Sections
 * hold lists, forms or cards — never explanatory paragraphs.
 */
export function SettingsSection({
  id,
  title,
  meta,
  purpose,
  actions,
  status,
  className,
  children,
}: {
  id: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  purpose?: React.ReactNode;
  actions?: React.ReactNode;
  /** A transient inline status next to the title ("Saved"); use `Swap` so it crossfades. */
  status?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className={cn("scroll-mt-6", className)}>
      <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-2", purpose ? "mb-1" : "mb-4")}>
        <h2 id={`${id}-h`} className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {meta && <span className="text-muted-foreground text-meta tabular-nums">{meta}</span>}
        {status}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {purpose && <p className="text-muted-foreground mb-4 max-w-[64ch] text-meta">{purpose}</p>}
      {children}
    </section>
  );
}

/** The bordered surface a section's list or form sits in. One elevation: border, no shadow. */
export function Panel({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("bg-card overflow-hidden rounded-xl border", className)} {...props}>
      {children}
    </div>
  );
}

/** The quiet strip under a list where the "add" input lives. */
export function PanelFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("bg-muted/40 flex items-center gap-2 border-t px-3.5 py-2.5", className)}>{children}</div>;
}
