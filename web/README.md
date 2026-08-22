# agent-sandbox dashboard

React + Vite + Tailwind v4 + vendored shadcn/ui components. Built into `web/dist` and served by the
same express container that serves `/mcp`, mounted at `/dashboard`.

## Why the components are vendored

shadcn/ui is not an npm runtime dependency — components are copied into the project so they can be
edited. The same applies to the chat primitives (`ChatBubble` / `ChatMessageList` / `ChatInput`),
which follow the shadcn-chat component shape. Runtime deps are only Radix primitives, CVA, clsx,
tailwind-merge, lucide-react, and React itself.

## Two conversational lanes

The UI must never let these be confused, and the bubble variants encode the difference:

- **Driver** — the agent doing the work. You steer it *only* by answering the question it is blocked
  on (`WaitingBanner` → `POST /resume.json`).
- **Co-pilot** — a read-only observer in the same box (`AskPanel` → `POST /ask.json`). It cannot
  change anything and cannot reach the driver. Dashed bubble border, distinct avatar.

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
