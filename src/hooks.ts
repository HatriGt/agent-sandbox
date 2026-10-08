import express, { type Express, type Request, type Response } from "express";
import { safeEqual } from "./triggers.js";
import type { RateLimiter } from "./auth-throttle.js";
import type { Principal } from "./identity.js";

/**
 * The one way an unauthenticated `/hooks/…` receiver is registered. Four receivers share it
 * (automation webhooks, PR follow-ups, email intake, Slack intake), and every one of them gets the
 * same front door, in the same order:
 *
 *   1. raw body with a cap (`hookBodyParser`; http.ts mounts it for /hooks/ BEFORE the JSON parsers)
 *   2. a per-target rate limit → 429 (one noisy repo or channel cannot eat the controller)
 *   3. `resolve` finds the target and its real secret; the URL secret is compared in CONSTANT time,
 *      always, so timing does not tell "no such id" from "wrong secret" — and both answer the SAME
 *      404 {error:"not found"}. A receiver without a URL secret (Slack signs the body instead)
 *      returns no `secret` and skips the compare.
 *   4. the receiver's own `handle` with the exact raw bytes (vendor signatures are over them)
 *
 * The secret is a path segment, so http.ts's audit line masks /hooks/ paths (`hookAuditPath`).
 */

/** Automation + follow-up hooks: GitHub deliveries. */
export const HOOK_BODY_LIMIT = "512kb";
/** Intake: an email with image attachments is far past the 512 KB hook cap. */
export const INTAKE_BODY_LIMIT = "25mb";
const rawSmall = express.raw({ type: () => true, limit: HOOK_BODY_LIMIT });
const rawIntake = express.raw({ type: () => true, limit: INTAKE_BODY_LIMIT });
/** The raw-body parser for /hooks/: picks the cap by path. `originalUrl`, so it works mounted under /hooks too. */
export const hookBodyParser: express.RequestHandler = (req, res, next) =>
  (req.originalUrl.startsWith("/hooks/intake/") ? rawIntake : rawSmall)(req, res, next);

/** `/hooks/<id>/<secret>` → `/hooks/<id>/***` for every log and audit row. */
export function hookAuditPath(path: string): string {
  const m = path.match(/^\/hooks\/([^/]+)\/[^/]*/);
  return m ? `/hooks/${m[1]}/***` : path;
}

export interface HookSpec<T> {
  /** Express path under /hooks/. The target id is `:id`; the URL secret, when any, is `:secret` or `:token`. */
  path: string;
  limiter: RateLimiter;
  /** Rate-limit key for a target id (default: the id itself). */
  key?: (id: string) => string;
  /** The target for an id and the real secret the URL must carry (omit `secret` when the URL carries none). */
  resolve(id: string, req: Request): { target: T; secret?: string } | undefined;
  /** A known target with the wrong URL secret: log it before the 404. */
  onWrongSecret?(target: T): void;
  /** Everything after the front door. `secret` is the real one (for HMAC checks over `raw`). */
  handle(target: T, raw: Buffer, req: Request, res: Response, secret: string | undefined): Promise<void> | void;
  /** Errors thrown by `handle`. */
  failWith(res: Response, e: unknown): void;
}

export function registerHook<T>(app: Express, spec: HookSpec<T>): void {
  app.post(spec.path, async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").slice(0, 64);
    if (spec.limiter.over(spec.key ? spec.key(id) : id)) {
      res.setHeader("Retry-After", "60");
      return void res.status(429).json({ error: "slow down" });
    }
    const hit = spec.resolve(id, req);
    const given = req.params.secret ?? req.params.token;
    let ok = !!hit;
    if (given !== undefined) {
      // Always compare, even for an unknown id, so timing does not tell "no such target" from "wrong secret".
      const okSecret = safeEqual(hit?.secret ?? "\u0000no-target\u0000", String(given));
      if (hit?.secret && !okSecret) spec.onWrongSecret?.(hit.target);
      ok = ok && !!hit?.secret && okSecret;
    }
    if (!ok || !hit) return void res.status(404).json({ error: "not found" });
    const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
    try {
      await spec.handle(hit.target, raw, req, res, hit.secret);
    } catch (e) {
      spec.failWith(res, e);
    }
  });
}

export interface RotateCtx {
  dashAuthed(req: Request, res: Response): boolean;
  principalOf(res: Response): Principal;
  failWith(res: Response, e: unknown): void;
  audit(owner: string, action: string, detail: Record<string, string | undefined>): void;
}

/**
 * One authenticated "rotate the secret" endpoint body: auth → rotate → audit → answer. `rotate`
 * returns undefined when the thing to rotate does not exist (→ 404 `notFound`); errors go to failWith.
 */
export function rotateSecret<R>(
  c: RotateCtx,
  req: Request,
  res: Response,
  o: { owner: (p: Principal) => string; action: string; rotate(owner: string): R | undefined; notFound: string; detail?: (r: R) => Record<string, string | undefined>; body(r: R, owner: string): unknown }
): void {
  if (!c.dashAuthed(req, res)) return;
  const owner = o.owner(c.principalOf(res));
  try {
    const r = o.rotate(owner);
    if (r === undefined) return void res.status(404).json({ error: o.notFound });
    c.audit(owner, o.action, o.detail ? o.detail(r) : {});
    res.json(o.body(r, owner));
  } catch (e) {
    c.failWith(res, e);
  }
}
