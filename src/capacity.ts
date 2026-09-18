/**
 * In-flight box reservations. The capacity check ("live < maxBoxes, ok, boot") is a read followed
 * by a boot seconds later — pure TOCTOU: N concurrent delegates all read live = max-1, all pass,
 * and the fleet overshoots by N-1 boxes on a host where RAM is budgeted per slot. A reservation is
 * taken SYNCHRONOUSLY with the check and held until the boot either registers in `msb ls` (the
 * delegation returned) or failed, so concurrent checks count each other.
 */
let reserved = 0;

/**
 * Atomically check `live + inFlight < max` and take a slot. Returns a release function when the
 * slot was granted, or null when the fleet (including in-flight boots) is at capacity.
 */
export function reserveBox(live: number, max: number): (() => void) | null {
  if (live + reserved >= max) return null;
  reserved++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reserved--;
  };
}

/** In-flight reservations right now (for capacity messages). */
export function reservedBoxes(): number {
  return reserved;
}
