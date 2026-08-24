/**
 * The transient booting-state copy, kept pure and honest. A warm claim reuses a pre-booted pool box
 * (no microVM boot), so asserting "Booting a fresh microVM" for it is a lie the user can see (they
 * sent a task with a warm box ready and watched a fake boot). Reserve the cold-boot copy for a real
 * cold boot (pool empty). Extracted so the warm-vs-cold branch is unit tested without React.
 */
export function bootingLabel(warm: boolean): string {
  return warm ? "Starting your task on a warm sandbox" : "Booting a fresh microVM";
}
