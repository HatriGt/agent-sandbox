# Contributing

Thanks for taking a look. This is a young project and the surface area is unusual (microVMs, MCP,
in-box hooks), so this file is mostly about *how to work on it without needing a VPS*.

## The dev loop

```bash
npm ci
npm run build     # tsc -p tsconfig.json  (typecheck IS the build; it emits dist/)
npm test          # node:test via tsx — 298 unit tests, none of which need a VPS
npm run test:watch
```

The dashboard is a separate workspace with its own lockfile:

```bash
npm --prefix web ci
npm --prefix web run build
```

You do **not** need microsandbox, a VPS or an Anthropic key to work on the orchestrator. Every test
is a pure unit: the side-effecting parts (SSH, `msb`, the filesystem) live behind `src/deps.ts`, and
the logic that matters is factored out so it can be tested directly.

## Testing conventions

- **Pure first.** If a behaviour is worth a test, it is worth extracting from the I/O that surrounds
  it. `src/http-auth.ts`, `src/security-headers.ts` and `src/guard.ts` are the pattern to copy: a
  small pure module, plus a test that states the *property* rather than the implementation.
- **Security-relevant code gets a regression test that fails loudly.** The guard denylist, the auth
  guard, the CSP profiles and the highlighter escaping audit all have tests written so that
  *weakening* them breaks CI. If you touch one, keep that property.
- Tests live in `test/*.test.ts` and run under `tsx`. A test may import from `web/src` when the logic
  is pure (see `test/markdown-code.test.ts`) rather than adding a second test runner.
- Tests that need an optional workspace dependency should **skip**, not fail, when it is absent
  (see `test/code-highlight-escaping.test.ts`).

## What a good PR looks like

- One concern per PR, with a title that says what changed for a user.
- Explain the *why* in the description — this codebase leans heavily on comments that record
  reasoning, and PRs are held to the same bar.
- New behaviour comes with tests. Bug fixes come with the regression test first if you can.
- Comments should say why, not what. Match the density and voice of the surrounding code.
- Keep `docs/` honest: if you change the security posture, update `docs/security.md`, including the
  **Known gaps** section. An honest gap is worth more than an optimistic claim.

## Before you push

```bash
npm run build && npm test
```

CI runs the same thing on Node 20 and 22. The `web build` job is currently **non-blocking** while
some outstanding type errors in the changes/file panes are fixed — if you are working in `web/`,
please don't add new ones, and flipping that job to blocking is a very welcome PR.

## Areas that need help

- **Real authentication** to replace the single shared bearer token (per-user sessions, revocation,
  audit log). This is the single highest-value change in the project — see
  [Known gaps](docs/security.md#known-gaps-honest).
- Rate limiting on the token check.
- Egress deny-by-default for RFC1918 / link-local ranges even in open mode.
- Widening the guard hook's coverage — with a test that demonstrates the bypass first.
- Screenshots, docs and a demo GIF. Genuinely valuable, and a good first contribution.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
