import { AsyncLocalStorage } from "node:async_hooks";
import type { Config } from "./config.js";
import type { HandlerDeps } from "./handlers.js";
import type { Db } from "./db.js";
import { forgetBox, getUser, mayAccess, ownedBoxNames, planOf, recordBoxOwner, TrialExpiredError, type Principal } from "./identity.js";
import { formatMonitor } from "./monitor.js";
import { gatherMonitor } from "./msb.js";

/**
 * The principal travels with the request through async continuations, so the shared `deps` (used by
 * both the JSON routes and the MCP tools) can enforce ownership without every caller threading a
 * user through. `withPrincipal` wraps a request; `currentPrincipal` reads it anywhere below.
 */
const als = new AsyncLocalStorage<Principal>();
export const withPrincipal = <T>(p: Principal, fn: () => T): T => als.run(p, fn);
/** Outside any request (pool maintainer, inbox delivery, tests) the caller is the operator. */
export const currentPrincipal = (): Principal => als.getStore() ?? { kind: "operator" };

export class NotOwnedError extends Error {
  constructor(session: string) {
    super(`Unknown session ${session}`);
    this.name = "NotOwnedError";
  }
}
export class QuotaError extends Error {
  constructor(n: number, max: number) {
    super(`You have ${n} of ${max} machines running. Finish or destroy one to start another.`);
    this.name = "QuotaError";
  }
}

export interface Ownership {
  /** Throws TrialExpiredError when the current user may not start or resume machines. */
  assertCanRun(): void;
  check(session: string): void;
  record(box: string, taskHead?: string): void;
  forget(box: string): void;
  /** Filter a fleet listing to what the current principal may see. */
  visible<T extends { name: string; role: string }>(boxes: T[]): T[];
  /** Throws QuotaError when the current user is at their concurrent-box limit. */
  assertQuota(liveOwned: number, max: number): void;
  /** How many of these boxes the current user owns and are up. */
  liveOwned<T extends { name: string; boxStatus: string }>(boxes: T[]): number;
  isUser(): boolean;
}

export function makeOwnership(db: Db, cfg: Config): Ownership {
  const userOnly = (p: Principal): p is Extract<Principal, { kind: "user" }> => p.kind === "user" && p.role !== "admin";
  return {
    isUser: () => userOnly(currentPrincipal()),
    assertCanRun() {
      const p = currentPrincipal();
      if (!userOnly(p)) return;
      const u = getUser(db, p.userId);
      if (u && planOf(u).expired) throw new TrialExpiredError();
    },
    check(session) {
      const p = currentPrincipal();
      if (!mayAccess(db, p, session)) throw new NotOwnedError(session);
    },
    record(box, taskHead) {
      const p = currentPrincipal();
      recordBoxOwner(db, box, p.kind === "user" ? p.userId : null, taskHead);
    },
    forget(box) {
      forgetBox(db, box);
    },
    visible(boxes) {
      const p = currentPrincipal();
      if (!userOnly(p)) return boxes;
      const mine = ownedBoxNames(db, p.userId);
      return boxes.filter((b) => b.role !== "pool-free" && mine.has(b.name));
    },
    liveOwned(boxes) {
      const p = currentPrincipal();
      if (!userOnly(p)) return 0;
      const mine = ownedBoxNames(db, p.userId);
      return boxes.filter((b) => mine.has(b.name) && /^running$/i.test(b.boxStatus)).length;
    },
    assertQuota(liveOwned, max) {
      if (!userOnly(currentPrincipal())) return;
      if (liveOwned >= (max || cfg.userMaxBoxes)) throw new QuotaError(liveOwned, max || cfg.userMaxBoxes);
    },
  };
}

/**
 * Every box-scoped dep checks ownership first; a delegation records its owner; a teardown forgets it.
 * Wrapping here means the MCP tools (handlers.ts) and the JSON routes are protected by the same code.
 */
export function guardDeps(deps: HandlerDeps, own: Ownership): HandlerDeps {
  // Async wrappers: an ownership failure is a rejected promise, never a synchronous throw, so every
  // caller's `await`/`.catch` sees it the same way it would see any other failing dep.
  const guarded: HandlerDeps = {
    ...deps,
    async runDelegation(cfg, plan, allowDomains, creds, interact) {
      own.assertCanRun();
      const r = await deps.runDelegation(cfg, plan, allowDomains, creds, interact);
      own.record(r.box, plan.task?.split("\n")[0]);
      return r;
    },
    async status(cfg, session, interact) {
      own.check(session);
      return deps.status(cfg, session, interact);
    },
    async resume(cfg, session, message, secrets, interact, model) {
      own.check(session);
      own.assertCanRun();
      return deps.resume(cfg, session, message, secrets, interact, model);
    },
    async teardown(cfg, session) {
      own.check(session);
      await deps.teardown(cfg, session);
      own.forget(session);
    },
    async watch(cfg, session, lines) {
      own.check(session);
      return deps.watch(cfg, session, lines);
    },
    async ask(cfg, session, question, newThread) {
      own.check(session);
      return deps.ask(cfg, session, question, newThread);
    },
    // The text fleet report (MCP `monitor`) shows a user only their own machines; the pool is infrastructure.
    async monitor(cfg) {
      if (!own.isUser()) return deps.monitor(cfg);
      const mine = own.visible(await gatherMonitor(cfg));
      return mine.length ? formatMonitor(mine) : "No machines yet. delegate() starts one — it will be yours alone.";
    },
  };
  if (deps.resumeDetached) {
    const rd = deps.resumeDetached.bind(deps);
    guarded.resumeDetached = async (cfg, session, message, secrets, model) => {
      own.check(session);
      own.assertCanRun();
      return rd(cfg, session, message, secrets, model);
    };
  }
  if (deps.verify) {
    const vf = deps.verify.bind(deps);
    guarded.verify = async (cfg, session, plan) => {
      own.check(session);
      return vf(cfg, session, plan);
    };
  }
  if (deps.handoff) {
    const hf = deps.handoff.bind(deps);
    guarded.handoff = async (cfg, after, input) => {
      own.check(after); // you may only chain off your OWN boxes — a handoff reads the parent's tree
      return hf(cfg, after, input);
    };
  }
  if (deps.rewind) {
    const rw = deps.rewind.bind(deps);
    guarded.rewind = async (cfg, session) => {
      own.check(session);
      return rw(cfg, session);
    };
  }
  if (deps.attachRepo) {
    const ar = deps.attachRepo.bind(deps);
    guarded.attachRepo = async (cfg: Config, session: string, repo: string, ref?: string) => {
      own.check(session);
      return ar(cfg, session, repo, ref);
    };
  }
  return guarded;
}
