/**
 * The trace parser is shared verbatim with the server (the digest at src/digest.ts derives from the
 * same events the thread renders), so the canonical module lives in src/trace.ts and this file only
 * re-exports it. Vite follows the relative import fine; the server's tsconfig rootDir covers it.
 */
export * from "../../../src/trace";
