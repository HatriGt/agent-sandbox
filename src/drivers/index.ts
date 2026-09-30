/**
 * The driver registry. Adding a driver = one module satisfying src/drivers/types.ts plus one entry
 * here; the delegate flow, thread, digest and mobile never branch on the kind.
 */
import type { Driver, DriverKind } from "./types.js";
import { meetsSupervisionFloor } from "./types.js";
import { claudeDriver } from "./claude.js";
import { ompDriver } from "./omp.js";

export const DRIVERS: Record<DriverKind, Driver> = {
  claude: claudeDriver,
  omp: ompDriver,
};

export function driverFor(kind: DriverKind): Driver {
  return DRIVERS[kind] ?? claudeDriver;
}

/** The public, serialisable view of a driver for the API and the pickers. */
export interface DriverInfo {
  kind: DriverKind;
  label: string;
  capabilities: Driver["capabilities"];
  /** false → below the supervision floor; the UI must badge it "supervised: partial". */
  supervised: boolean;
}

export function driverInfo(d: Driver): DriverInfo {
  return { kind: d.kind, label: d.label, capabilities: d.capabilities, supervised: meetsSupervisionFloor(d.capabilities) };
}

export function listDrivers(): DriverInfo[] {
  return Object.values(DRIVERS).map(driverInfo);
}

export type { Driver, DriverKind } from "./types.js";
export { meetsSupervisionFloor } from "./types.js";
