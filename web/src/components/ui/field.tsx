import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one text input look — hairline border, the console's focus ring, `aria-invalid` turns it red.
 * Use `inputClass` on bare inputs/textareas (or the `Input` wrapper); `mono` for URLs, tokens and
 * anything the person will paste rather than read.
 */
export const inputClass =
  "border-line-strong bg-transparent text-foreground placeholder:text-muted-foreground h-9 w-full min-w-0 rounded-md border px-3 text-meta outline-none " +
  "transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 " +
  "aria-invalid:border-destructive/60 aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/30 disabled:cursor-not-allowed disabled:opacity-50";
/** Same look for composite controls (a label wrapping an icon + input). */
export const fieldClass = inputClass;

export function Input({ className, mono, ...props }: React.ComponentProps<"input"> & { mono?: boolean }) {
  return <input className={cn(inputClass, mono && "font-mono", className)} {...props} />;
}

type Wire = { id: string; "aria-invalid": true | undefined; "aria-describedby": string | undefined };

/**
 * A labelled form control: `.label` on top (with an optional `trailing` counter/action and an
 * `optional` mark), the control, then ONE line under it — `error` (destructive) wins over `ok`
 * (confirmation) wins over `hint`/`help` (muted). Children may be a node or a function receiving the
 * wiring (`id`, `aria-invalid`, `aria-describedby`) to spread onto the control; pass `htmlFor` when
 * the control has its own id. Every settings form, dialog and editor uses this so labels, spacing
 * and error colour agree everywhere.
 */
export function Field({
  label,
  htmlFor,
  hint,
  help,
  error,
  ok,
  optional,
  trailing,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  /** Alias of `hint`. */
  help?: React.ReactNode;
  error?: React.ReactNode;
  ok?: React.ReactNode;
  optional?: boolean;
  trailing?: React.ReactNode;
  className?: string;
  children: React.ReactNode | ((wire: Wire) => React.ReactNode);
}) {
  const auto = React.useId();
  const id = htmlFor ?? auto;
  const descId = `${id}-desc`;
  const note = error ? "error" : ok ? "ok" : hint || help ? "hint" : null;
  const wire: Wire = { id, "aria-invalid": error ? true : undefined, "aria-describedby": note ? descId : undefined };
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="label text-muted-foreground flex items-baseline gap-1.5">
          {label}
          {optional && <span className="text-faint font-normal">optional</span>}
        </label>
        {trailing}
      </div>
      {typeof children === "function" ? children(wire) : children}
      {note && (
        <p id={descId} role={note === "error" ? "alert" : undefined} className={cn("text-micro", note === "error" ? "text-destructive" : note === "ok" ? "text-ok" : "text-faint")}>
          {note === "error" ? error : note === "ok" ? ok : hint || help}
        </p>
      )}
    </div>
  );
}
