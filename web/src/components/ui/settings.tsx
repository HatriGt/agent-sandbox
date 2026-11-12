import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionNav } from "@/components/ui/section-nav";
import { cn } from "@/lib/utils";

/**
 * Every settings/admin page is the same shape: optional back link, one serif title with a one-line
 * purpose and the page's primary action on the right, then stacked sections. The page fills the
 * shared frame; on a wide page a sticky `SectionNav` follows the scroll (it hides itself under
 * three sections) and each section puts its name and purpose beside its content instead of above
 * it. Width is measured on the page itself (a container query), not the window, so an open
 * sidebar never squeezes a two-column layout into a space too small for it. The shell owns the
 * scroll container so the nav's IntersectionObserver has the right root.
 */
export function SettingsPage({
  title,
  purpose,
  actions,
  back,
  children,
  width,
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
    <div ref={scrollRef} className="@container h-full min-w-0 overflow-y-auto">
      <div className={cn("page-frame py-6 md:py-8", width, "@7xl:grid @7xl:grid-cols-[minmax(0,1fr)_auto]")}>
        <div className="hidden @7xl:col-start-2 @7xl:row-span-2 @7xl:row-start-1 @7xl:block">
          <div className="sticky top-8 pt-[4.25rem]">
            {/* The index sizes its own column: a page with too few sections to index gives the
                whole width to its content instead of keeping an empty rail. */}
            <SectionNav scrollRef={scrollRef} className="ml-12 w-40" />
          </div>
        </div>
        <div className="@7xl:col-start-1 @7xl:row-start-1">
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
        <div className="flex flex-col gap-11 @7xl:col-start-1 @7xl:row-start-2">{children}</div>
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
  stacked = false,
  className,
  children,
}: {
  /** Keep the heading above the content at every width: for a section that is one wide table. */
  stacked?: boolean;
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
  // One DOM order, two layouts. Narrow: a wrapping row (name, then the controls pushed right),
  // the purpose and the content each on their own line. Wide: a 15rem label column (name over
  // purpose) beside the content, with the controls above the content's right edge. The third,
  // flexible row takes the content's extra height so the purpose stays under the name.
  return (
    <section
      aria-labelledby={`${id}-h`}
      className={cn(
        "flex scroll-mt-6 flex-wrap items-center gap-x-2 gap-y-2",
        !stacked && "@5xl:grid @5xl:grid-cols-[15rem_minmax(0,1fr)] @5xl:grid-rows-[auto_auto_1fr] @5xl:items-start @5xl:gap-x-10",
        className
      )}
    >
      <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", !stacked && "@5xl:col-start-1 @5xl:row-start-1")}>
        <h2 id={`${id}-h`} className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {meta && <span className="text-muted-foreground text-meta tabular-nums">{meta}</span>}
        {status}
      </div>
      {actions && <div className={cn("ml-auto flex items-center gap-2", !stacked && "@5xl:col-start-2 @5xl:row-start-1 @5xl:ml-0 @5xl:justify-self-end")}>{actions}</div>}
      {purpose && <p className={cn("text-muted-foreground -mt-1 max-w-[64ch] basis-full text-meta", !stacked && "@5xl:col-start-1 @5xl:row-start-2 @5xl:mt-0")}>{purpose}</p>}
      <div className={cn("mt-2 w-full min-w-0 basis-full", !stacked && "@5xl:col-start-2 @5xl:mt-0", !stacked && (actions ? "@5xl:row-span-2 @5xl:row-start-2" : "@5xl:row-span-3 @5xl:row-start-1"))}>{children}</div>
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
