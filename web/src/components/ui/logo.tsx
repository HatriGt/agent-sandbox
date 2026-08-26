import { cn } from "@/lib/utils";

/**
 * Agent Sandbox mark — a single geometric glyph, not a stock icon.
 *
 * Concept: an isometric cube (the ephemeral microVM "box") with one bright face — the agent working
 * inside its isolated sandbox. Drawn on a 24×24 grid with `currentColor`, so it inherits the brand
 * container's foreground and themes cleanly in light/dark. The lit face uses a lower opacity of the
 * same colour rather than a second hue, keeping the mark monochrome and crisp at 16px.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-full", className)}
      aria-hidden
      role="presentation"
    >
      {/* cube silhouette: top rhombus + two side faces, isometric */}
      <path
        d="M12 2.75 20.5 7v10L12 21.25 3.5 17V7L12 2.75Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.9"
      />
      {/* top face fold + vertical spine, giving the cube its 3D read */}
      <path
        d="M3.5 7 12 11.5 20.5 7M12 11.5V21.25"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
      {/* the lit inner face — the agent at work inside the box */}
      <path d="M12 11.75 19.5 7.5v8.7L12 20.5v-8.75Z" fill="currentColor" opacity="0.16" />
    </svg>
  );
}
