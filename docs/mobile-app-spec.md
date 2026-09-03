# Agent Sandbox Mobile — Product & Design Spec (Draft v1)

Native iOS + Android companion apps for Agent Sandbox. Same product, same design language, rethought for the pocket. This spec covers scope, UX, screen-by-screen design, API/auth mapping, push notifications, and the server work required.

Guiding line from `web/DESIGN.md` principle #6: **"the phone is not a degraded desktop."** The app is not the dashboard shrunk down — it is the *triage and steering* surface. You start runs, get pinged when a run needs you, answer questions, review diffs, merge PRs, and revert. Deep code editing stays on desktop.

---

## 1. Product goals & non-goals

### Goals
1. **Never miss `waiting`.** The one state that needs a human (product principle #1) becomes a real push notification with actionable options on the lock screen.
2. **Full steering loop on the phone**: delegate → watch live → answer questions → review changes → commit/push → merge PR → teardown/revert.
3. **Feel like the same product**: same tokens, type scale, state colors, motion vocabulary, and copy voice as the web dashboard.
4. **First-class dark and light mode**, following system.

### Non-goals (v1)
- No in-app code *editing* (CodeMirror pane is desktop-only today; read-only file viewing + diffs are in).
- No run history / analytics (the server stores none by design — principle #4).
- No admin panel, no MCP-server management, no skills authoring (view/pick skills only).
- No offline mode beyond cached last snapshot (everything is live-VM state).
- No tablet-optimized layout in v1 (works, but phone-first).

---

## 2. Platform & stack decision

**Recommendation: one codebase, React Native (Expo) + TypeScript.**

Why:
- The wire types already exist in TypeScript (`web/src/lib/api.ts`) — `BoxView`, `WatchSnapshot`, `FileDiff`, `PullInfo`, etc. can be extracted into a shared `packages/asb-client` and reused verbatim.
- The team is one TS codebase today; a Swift + Kotlin split doubles surface area for a companion app.
- The UI is text/list/stream heavy — no heavy native rendering need.
- CSP is irrelevant to a native app (no WebView shell — a WebView on another origin is blocked by `connect-src 'self'` + `frame-ancestors 'none'` anyway, so hybrid is explicitly ruled out).

Key libraries: Expo Router (navigation), `react-native-sse`-style custom fetch-stream client (see §7), Reanimated (motion), `expo-notifications` + APNs/FCM, `expo-secure-store` (keychain/keystore for the API key), FlashList (thread virtualization), a shiki-compatible syntax highlighter or `react-native-syntax-highlighter` for read-only code.

Fonts ship in-app: **Inter Variable** (UI), **Hedvig Letters Serif** (display greeting), **Geist Mono** (machine data) — same trio as `web/src/index.css`.

---

## 3. Design language (carried over 1:1)

### Tokens
Port the oklch palette from `web/src/index.css` as a `theme.ts` with light/dark objects (converted to hex/P3 at build time; both iOS and Android render P3). The six **functional state colors** are the core identity and must survive exactly:

| State | Token | Meaning | Pairing rule |
|---|---|---|---|
| working | `--live` (blue) | running, links, streaming caret | always icon + word |
| needs you | `--attention` (amber) | `waiting` — reserved exclusively for this | amber fill, `--attention-ink` text |
| done | `--ok` (green) | exit 0 | |
| failed | `--destructive` (red) | non-zero exit, destroy | |
| sleeping | `--sleep` (violet) | `boxStatus: Stopped` | |
| idle | muted ink | pool-free | |

Rules carried over: color is functional only; every state color pairs with an icon **and** a word; the single primary action is ink on paper; **border OR shadow, never both**; elevation scale e1–e5 maps to native shadow levels.

### Type scale
Same scale as web (`micro 11 · meta 13 · body 14 · lead 15 · prose 15.5/1.7 · code 12.5 mono · h3 16 · h2 20 · h1 28 · display 34 serif`), with Dynamic Type / font-scale multipliers applied on top (respect OS accessibility settings; clamp at ~1.4× for layout-critical rows).

### Motion
Same single idea — **liveness**: `breathe` on the working dot and streaming caret, cross-fade 160ms between panes, shimmer skeletons, layout-animated triage reordering of box rows. All collapsed under the OS reduce-motion setting.

### Voice
Same copy voice as the dashboard: sentences, not labels ("2 machines running, 1 waiting on you"), turn numbers, exact state words.

---

## 4. Information architecture & navigation

Bottom tab bar (the phone-native replacement for the sidebar):

1. **Home** — the Hub: serif greeting, fleet sentence, composer, "Waiting on you" cards first, then live boxes.
2. **Fleet** — full box list with triage ordering (waiting → running → done → sleeping → idle), capacity meter.
3. **New** (center, prominent) — the delegate composer as a full-screen sheet.
4. **Activity** — notification inbox (mirror of pushes received: waiting/done/failed edges), tap-through to the box.
5. **Settings** — account, GitHub accounts, notification toggles, API key/device management, theme, plan/trial state.

**Thread** (the screen you live in) is pushed from anywhere a box is tapped: `asb://box/<name>` — also the deep-link target of every push notification.

No command palette, no keyboard shortcuts; their jobs move to: pull-to-refresh, long-press context menus on box rows (keep/sleep/wake/teardown), and swipe actions.

---

## 5. Screen-by-screen spec

### 5.1 Home (Hub)
- Serif display greeting (Hedvig, 34px) + one-sentence fleet summary — same as web Hub.
- **"Waiting on you"** section pinned first: amber-filled cards showing box title, the pending question (first line), and time waiting. Tapping opens Thread scrolled to the QuestionCard.
- "Live now" horizontal list of running boxes with breathing working-dot + last output age.
- Inline mini-composer ("Delegate a task…") that expands to the New sheet.

### 5.2 New / Delegate (full-screen sheet)
- Multiline task field, repo picker (recents first, search via `GET /repos.json?q=`), optional ref, GitHub account picker when multiple.
- **Attachments**: camera + photo library → up to 8 images, <11MB each, sent as data URLs (matches `POST /delegate.json` contract). This is a phone superpower: photograph a whiteboard/bug and delegate it.
- Skill mentions: `/`-triggered skill menu backed by `GET /skills.json`.
- Submit is **fire-and-stream**: `POST /delegate.json` returns the box name → navigate immediately to Thread in "Booting" state and open the SSE stream. Never the blocking MCP shape.
- Trial-expired: composer disabled with an upgrade card linking `billingUrl` from `/me.json`.

### 5.3 Thread (core screen)
Single scrolling column (FlashList), stick-to-bottom while streaming, with:
- **Header (56px)**: title, state pill (icon + word + color), repo chips, overflow menu (rename, keep/pin, sleep/wake, teardown — see §5.7).
- **Transcript**: agent prose at 15.5/1.7, turn separators with turn numbers, trace/tool output in collapsed mono blocks on the dark `--trace` panel (dark in both themes, same as web). Streaming caret breathes in `--live`.
- **QuestionCard**: when `runState=waiting`, a structured card with tappable option buttons (number keys → big touch targets) + "Something else…" free-text. Answers go through `POST /resume.json` — the only steering channel. The card is sticky above the composer until answered.
- **Composer (SendBar)**: reply → `resume.json`; supports mid-turn queueing (`/inbox.json` + `POST /send-now.json` "send now" affordance); `@`-mention file search via `GET /files.json?q=`.
- **Ask lane**: a distinct "Ask about this run" input (separate visual identity — outlined, secondary) → `POST /ask.json`. Read-only co-pilot answers render inline but visually distinct from the driver lane. Never conflate the two lanes.
- **Thread minimap** → replaced by a fast-scroll handle with turn-number bubbles.
- **Bottom dock chips** (horizontally scrollable above composer): Changes (n files), PR status, Checkpoints, Produced files, Run summary — each opens a sheet (§5.4–5.6).

### 5.4 Changes & Diffs (sheet)
- File list from `GET /changes.json` with +/− counts.
- Tap → unified diff view (`GET /diff.json`), syntax-highlighted, read-only, horizontally scrollable code with pinch-zoom font size. (Side-by-side merge view stays desktop-only.)
- Actions: **Commit** (message field, per-repo) and **Push** via `POST /git.json`. Status via `action:"status"`.

### 5.5 Pull Request (sheet)
- From `GET /pr.json`: state, additions/deletions, mergeability, review decision, reviewers, checks summary (n passing / failing / pending with state colors).
- **Merge**: method picker (merge/squash/rebase), auto-merge toggle, and admin-override behind its own **arm-to-confirm** (see §5.7) → `POST /pr/merge.json`.

### 5.6 Checkpoints / Revert (sheet)
- List from `GET /revert-points.json` (ring of 5, per-turn tars).
- Revert is destructive: arm-to-confirm, with copy stating exactly what reverts (workspace + agent memory + visible thread as one unit; heavy dirs preserved).

### 5.7 Destructive-action pattern (everywhere)
Replicate the web's **arm-to-confirm with 4s auto-disarm** — do not simplify to a system alert. Tap once → button turns `--destructive` with countdown ring and exact consequence copy ("Destroys the VM and its transcript") → tap again within 4s to execute. Applies to: teardown, revert, admin-override merge, revoke device/API key, delete account.

### 5.8 Fleet
- Triage-ordered list (layout-animated reordering as states change): waiting first, amber; then running with vitals-lite (uptime, last output age — skip cpu/mem on phone); done; sleeping (violet, "wakes on reply"); pool.
- Capacity sentence ("3 of 5 slots occupied") with the sheen animation on occupied slots.
- Swipe actions: right = keep/pin; left = sleep (or wake). Long-press = full context menu incl. teardown (armed).

### 5.9 Activity
- Chronological list of notification edges this device received: `waiting` (amber), `done` (green), `failed` (red), each with box title + tap-through. Local storage only (server keeps no history); cap ~200 entries.

### 5.10 Settings
- Account (name/email/password via `/account.json`), plan/trial badge + upgrade link.
- **Notifications**: per-event toggles {waiting, done, failed} mapped to the device registration (§8); test button.
- GitHub accounts: list/add via the existing **device flow** (`POST /accounts/device.json` + poll) — ideal on mobile (show the code, deep-link to github.com/login/device).
- Signed-in devices (`/sessions.json`) + API keys (`/api-keys.json`) with revoke.
- Theme: system/light/dark. Sign out.

---

## 6. Onboarding & auth

Server has two modes; the app supports both:

1. **SaaS mode** (primary): Sign in screen (password or GitHub OAuth in a system browser tab / ASWebAuthenticationSession → callback deep link). On success the app immediately **mints a device-scoped API key** (`POST /api-keys.json`, name = device model) and stores it in Keychain/Keystore; all subsequent calls use `Authorization: Bearer asb_…`. This avoids cookie+CSRF handling in native code and gives per-device revocation for free (shows up in Settings → API keys).
2. **Self-host token mode**: "Connect to your server" screen — server URL + operator token, stored in secure storage. Same bearer header.

First-run flow: server URL (or default SaaS host) → sign in → notification permission prompt *with context* ("Get pinged the moment an agent needs you") → land on Home.

Errors: ownership checks return **404, never 403** — the app must treat 404 on a box route as "gone or not yours" with a neutral "This machine no longer exists" screen. 401 → sign-in. Rate limit (60 mutations/min) → toast with retry-after.

---

## 7. Realtime: SSE client

There is no WebSocket; the channel is `GET /watch.sse?session=&from=<byteOffset>` and **native `EventSource` can't be used** (header auth). Implement a small fetch-stream SSE parser (mirroring `web/src/lib/api.ts openSse()`):

- Frames: `snapshot` (replace buffer) · `append` (byte delta) · `reset` (replace) · `state` (meta) · `done` (server closes → fall back to 3s `GET /watch.json` poll).
- Track byte offset from SSE `id`; on reconnect send `Last-Event-ID` / `?from=`.
- 15s heartbeats → dead-pipe detection with exponential backoff reconnect.
- **Backgrounding is the norm on mobile**: on app suspend, drop the stream; on resume, reconnect from the stored offset (the protocol is designed for exactly this). While backgrounded, push notifications (§8) carry the state edges.
- One stream per visible box only; Home/Fleet use `GET /fleet.json` polling (~3–5s foreground) rather than N streams.

---

## 8. Push notifications (the headline feature — requires server work)

Today the server has webhook-based edge notifications (`src/notify.ts`) and zero push infra (no device tokens, no APNs/FCM). Plan:

### Server additions
1. New table `push_devices (id, user_id → users, platform 'ios'|'android', token, name, prefs_json {waiting,done,failed}, created_at, last_seen_at, revoked_at)`.
2. Routes: `POST /push/register.json`, `DELETE /push/register.json`, `POST /push/test.json` (bearer-guarded like everything else).
3. Extend the existing notify edge-detector (`src/notify.ts` fleet sweep, edges only, first-sighting-is-hydration) to fan out to registered devices alongside the webhook. Payload stays the redacted `{text, url, event, box}` shape; add `box` for deep linking.
4. Delivery: **FCM for Android; APNs via token-based auth for iOS** (or Expo Push Service as the v1 shortcut — one API for both, defensible for a companion app; direct APNs/FCM in v2 if we want to drop the Expo dependency).
5. Same guarantees as the webhook: secrets redacted before send, failures swallowed, per-device prefs honored server-side (don't send then filter client-side).

### Notification UX
- `waiting`: **time-sensitive** interruption level (iOS) / high priority (Android), amber accent, body = the question's first line. Actions: **"Open"** and — when the pending question has enumerated options — up to 2 option buttons that fire `POST /resume.json` directly from the notification (background action → confirm toast). This is the killer interaction: answer an agent from the lock screen.
- `done` / `failed`: default priority, green/red, body = task head + exit summary.
- Tap → `asb://box/<name>`, Thread scrolled to the relevant point.
- Foreground: suppress system banner; show in-app toast + update Activity.

---

## 9. Server & shared-code work summary

| Item | Where | Size |
|---|---|---|
| `push_devices` table + migration | `src/db.ts` | S |
| `/push/register.json` routes | `src/http.ts` | S |
| Push fan-out in notify sweep | `src/notify.ts` | M |
| APNs/FCM (or Expo Push) sender + secrets | new `src/push.ts` | M |
| Include structured question options in notify payload | `src/notify.ts` | S |
| Extract shared wire types → `packages/asb-client` | from `web/src/lib/api.ts` | M |
| (Optional) `GET /auth/config.json` advertise mobile min-version | `src/http.ts` | S |

Everything else in the app consumes existing endpoints unchanged.

---

## 10. Milestones

- **M0 — Foundation (2–3 wks)**: Expo app shell, theme/tokens/fonts, auth (both modes), secure storage, API client + SSE parser, Home + Fleet read-only.
- **M1 — Steering loop (3–4 wks)**: Thread with live streaming, QuestionCard + resume, composer + queueing, ask lane, delegate sheet with attachments, teardown/keep/sleep/wake with arm-to-confirm.
- **M2 — Push (2 wks)**: server push infra, registration, waiting/done/failed notifications with actions, Activity tab.
- **M3 — Code & ship (3 wks)**: Changes/diff viewer, commit/push, PR sheet + merge, checkpoints/revert, Settings complete, polish (motion, haptics, reduce-motion, Dynamic Type), TestFlight + Play internal track.

### Open questions
1. Expo Push Service vs direct APNs/FCM for v1? (Recommend Expo for v1.)
2. Should notification quick-actions be allowed to `resume.json` without opening the app, or always confirm in-app first? (Recommend: allow for enumerated options only; free-text always opens the app.)
3. Biometric app lock (Face ID/fingerprint) before showing threads — v1 or v2?
4. Self-host distribution: same store binary with server-URL entry (recommended) vs separate build.
