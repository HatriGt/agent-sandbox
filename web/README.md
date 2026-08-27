# agent-sandbox dashboard

React + Vite + Tailwind v4 on a **shadcn (neutral) + Radix + prompt-kit** foundation with **Inter +
Hedvig Letters Serif + Geist Mono** fonts. Built into `web/dist` and served by the same express
container that serves `/mcp`, mounted at `/dashboard`. See `DESIGN.md` for the design reference
(layout, tokens, the functional state palette, chat surface) and `DESIGN-claude-code.md` for the
measured claude.ai chat-surface notes it borrows from.

## Why the components are vendored

Neither shadcn/ui nor prompt-kit is an npm runtime dependency — components are copied into
`src/components/ui/` so they can be edited. The chat surface is composed from prompt-kit's AI-chat
components (`chat-container`, `prompt-input`, `steps`, `tool`, `markdown`, `code-block`,
`scroll-button`, `reasoning`), installed with `npx shadcn add https://prompt-kit.com/c/<name>.json`;
they read the same shadcn token contract as the rest of the console. Runtime deps are the low-level
Radix *primitives* (dialog / scroll-area / slot / tooltip — not Radix Themes), CVA, clsx,
tailwind-merge, lucide-react, `use-stick-to-bottom`, react-markdown + remark + shiki, next-themes,
sonner, and React itself.

## Two conversational lanes

The UI must never let these be confused, and the trace items encode the difference:

- **Agent** — the driver doing the work. You steer it *only* by answering the question it is blocked
  on or sending a follow-up once it has finished. The composer's **Agent** destination →
  `POST /resume.json`; a pending question renders as an amber `AskingItem` with one-click choices.
- **Side question** — a separate read-only helper in the same box answers questions *about* the run.
  The composer's **Side question** destination → `POST /ask.json`. It cannot change anything and cannot
  reach the agent, and renders as a visibly distinct dashed `ObserverItem`.

Sending to the agent is always possible: while it is mid-turn the controller **queues** the message
(`/resume.json` → `{queued:true}`, `/inbox.json` to list/cancel) and delivers it when the turn ends.
Questions render as a `QuestionCard` with selectable options (`lib/question.ts`); `@` mentions list
workspace files from `/files.json`. A GitHub-auth question is answered by the controller's credential
broker from the stored account, so it never reaches you.

## Develop

```bash
npm install
ASB_API=https://agent-sandbox.ajeethkumar.dev npm run dev
# then open http://localhost:5173/dashboard/ and paste MCP_HTTP_TOKEN into the token gate
# the public landing page: http://localhost:5173/dashboard/welcome (served at / in production)
```

`vite.config.ts` proxies every data route (`/fleet.json`, `/monitor.json`, `/watch.json`, `/watch.sse`, `/artifact`, `/files.json`, `/inbox.json`,
`/ask.json`, `/resume.json`, `/teardown.json`, `/delegate.json`) to `ASB_API` (default
`http://127.0.0.1:8787`) so the UI can be developed against real boxes.

## Build

```bash
npm run build   # tsc -b && vite build -> web/dist
```

The Dockerfile does this during the image build; `web/node_modules` and `web/src` are dropped from
the runtime image.

## Lifecycle, sleeping machines, capacity

See `../docs/lifecycle.md`. In short: a quiet machine is **stopped, not destroyed** — the dashboard
shows it as *sleeping* and a reply wakes it; only the run cap or **Destroy** discards a workspace.
`/fleet.json` carries the configured timeouts and capacity so the UI can show real deadlines and
slots.

## Routes and pages

React Router v7 (browser history; the express SPA fallback serves `index.html` for `/` and
`/dashboard/*`). `/dashboard/accounts` manages GitHub accounts (`/accounts.json`, device flow via
`/accounts/device*.json` when `GITHUB_OAUTH_CLIENT_ID` is set). The thread folds extended thinking and
renders TodoWrite plans as a live checklist; sandboxes expose their checked-out repos (`repos` on the
fleet view), shown as chips in the thread header and used to scope `@` file search.

## Access

The dashboard asks for the controller token once and stores it in the browser (`localStorage`); every
request sends it as `Authorization: Bearer`. The controller no longer accepts `?token=`. See
`../docs/security.md` for the full model, including the in-sandbox guard hook.
