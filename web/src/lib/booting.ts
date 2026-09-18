/**
 * The transient booting-state copy, kept pure and honest. A warm claim reuses a pre-booted pool box
 * (no microVM boot), so asserting "Booting a fresh microVM" for it is a lie the user can see (they
 * sent a task with a warm box ready and watched a fake boot). Reserve the cold-boot copy for a real
 * cold boot (pool empty). Extracted so the warm-vs-cold branch is unit tested without React.
 */
export function bootingLabel(warm: boolean): string {
  return warm ? "Starting your task on a warm sandbox" : "Booting a fresh sandbox";
}

/**
 * The single working-indicator line for the booting pane, staged over the launch:
 *   1. no machine yet — the warm/cold boot copy (the delegate request is in flight);
 *   2. machine known  — name it, so the pane visibly progresses instead of repeating one line
 *      until the thread takes over.
 * Pure, so the stage transition is unit tested without React.
 */
export function bootingHeadline(warm: boolean, machine?: string): string {
  return machine ? `Connecting to ${machine}` : bootingLabel(warm);
}

/** The header pill's word for each stage: assigning → connecting. */
export function bootingStage(machine?: string): "assigning" | "connecting" {
  return machine ? "connecting" : "assigning";
}
