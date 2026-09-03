# Agent Sandbox Mobile

Native iOS + Android companion app (Expo / React Native), built to the spec in
`docs/mobile-app-spec.md`. Same design language as the web dashboard — the oklch
palette (converted to hex via `scripts/oklch-to-hex.js`), the Inter / Hedvig
Letters Serif / Geist Mono trio, the type scale, the six functional state
colors, and the arm-to-confirm destructive pattern — adapted to the phone.

## Run it

```sh
cd mobile
npm install
npx expo start          # scan the QR with Expo Go, or press a/i for an emulator
```

Native builds (needed for release / real splash assets): `npx expo prebuild` +
`npx expo run:android` / `run:ios`, or EAS Build.

## Sign in

- **SaaS mode**: username + password. On success the app mints a device-scoped
  `asb_` API key (shows up under Settings → API keys as "iPhone/Android · Agent
  Sandbox app") and stores it in the keychain; revoking it signs the device out.
- **Self-host token mode**: server URL + operator token via "Connect to your
  own server".

All auth is header-only (`Authorization: Bearer …`); nothing is ever put in a URL.

## What's inside

| Surface | Files |
|---|---|
| Splash + fonts + theme + auth gate | `app/_layout.tsx`, `src/theme/*` |
| Welcome / sign-in / sign-up / connect | `app/welcome.tsx`, `app/sign-in.tsx`, `app/sign-up.tsx`, `app/connect-server.tsx` |
| Hub (serif greeting, waiting-on-you first) | `app/(tabs)/home.tsx` |
| Fleet (triage order, capacity meter, long-press actions) | `app/(tabs)/fleet.tsx` |
| Delegate (repos, skills, camera/photo attachments) | `app/new.tsx` |
| Thread (SSE stream, trace, question card, reply/ask lanes, dock chips) | `app/box/[name].tsx` |
| Changes + diff + commit/push | `src/components/sheets/ChangesSheet.tsx` |
| PR status + merge (method / auto / admin-arm) | `src/components/sheets/PrSheet.tsx` |
| Checkpoints / revert | `src/components/sheets/CheckpointsSheet.tsx` |
| Machine actions (rename/pin/sleep/destroy) | `src/components/sheets/BoxActionsSheet.tsx` |
| Activity (device-local state edges) | `app/(tabs)/activity.tsx` |
| Settings: account, GitHub (device flow + PAT), MCP, skills, webhook notifications, API keys, devices, IDE connect, admin users | `app/(tabs)/settings.tsx`, `app/settings/*` |

The transcript parser (`src/lib/trace.ts`) and question parser
(`src/lib/question.ts`) are copied verbatim from the server/web — they are pure
and dependency-free. If those change upstream, re-copy them.

Realtime is SSE over `XMLHttpRequest` (`src/lib/sse.ts`) because RN's fetch has
no streaming body and `EventSource` can't send the auth header: byte-offset
frames (`snapshot | append | reset | state | done`), `Last-Event-ID` resume on
reconnect and after backgrounding, 3s poll fallback after `done`.

Not in v1 (by design, see the spec): in-app code editing, push notifications
(use Settings → Notifications to point the server's webhook at ntfy/Slack),
run history beyond the local Activity feed.
