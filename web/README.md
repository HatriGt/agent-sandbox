# agent-sandbox dashboard

React + Vite + Tailwind v4 on a **shadcn (neutral) + prompt-kit** foundation with **Inter + Hedvig
Letters Serif + Geist Mono** fonts. Built into `web/dist` and served by the same express container
that serves `/mcp`, mounted at `/dashboard`. See `DESIGN.md` for the full style reference (the chrome
is cloned from the CRM-AI-Agent reference) and `DESIGN-claude-code.md` for the chat-surface spec.

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

- **Driver** — the agent doing the work. You steer it *only* by answering the question it is blocked
  on. The `SendBar` "reply" mode → `POST /resume.json`; the pending question renders as `AskingItem`.
- **Co-pilot** — a read-only observer in the same box. The `SendBar` "ask" mode → `POST /ask.json`. It
  cannot change anything and cannot reach the driver, and renders as a visibly distinct `ObserverItem`
  (dashed edge, "read-only · the agent never saw this").

## Develop

```bash
npm install
ASB_API=https://agent-sandbox.ajeethkumar.dev npm run dev
# then open http://localhost:5173/dashboard/?token=<MCP_HTTP_TOKEN>
```

`vite.config.ts` proxies the JSON routes to `ASB_API` (default `http://127.0.0.1:8787`) so the UI
can be developed against real boxes.

## Build

```bash
npm run build   # tsc -b && vite build -> web/dist
```

The Dockerfile does this during the image build; `web/node_modules` and `web/src` are dropped from
the runtime image.
