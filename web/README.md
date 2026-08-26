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
- **Co-pilot** — a read-only observer in the same box. The composer's **Co-pilot** destination →
  `POST /ask.json`. It cannot change anything and cannot reach the agent, and renders as a visibly
  distinct dashed `ObserverItem` ("read-only · the agent never sees this").

The destination selector lives inside the composer; while the agent is mid-turn only Co-pilot is
available (and the composer says why).

## Develop

```bash
npm install
ASB_API=https://agent-sandbox.ajeethkumar.dev npm run dev
# then open http://localhost:5173/dashboard/?token=<MCP_HTTP_TOKEN>
```

`vite.config.ts` proxies every data route (`/fleet.json`, `/monitor.json`, `/watch.json`, `/watch.sse`, `/artifact`,
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
