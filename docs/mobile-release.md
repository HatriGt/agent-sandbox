# Mobile: shipping and anatomy

How the Android/iOS app is delivered — OTA updates over EAS Update, APKs from GitHub
Actions — and what the app itself is made of. `mobile/README.md` covers running it
locally; this doc covers getting a change onto a phone and knowing which path to use.

---

## 1. Which path do I need?

There are exactly two, and picking wrong is the usual reason "I pushed it but the phone
didn't change."

| You changed | Path | Time |
|---|---|---|
| Anything under `mobile/app/**` or `mobile/src/**` — screens, components, logic, copy, styles | **OTA update** (§2) | ~1 min |
| `app.json`, a native dependency, an asset in `mobile/assets/**`, the icon/splash, a new Expo config plugin, `runtimeVersion`/`version` | **New APK** (§3) — an OTA cannot carry it | ~10 min |

The rule behind the table: an OTA ships a **JavaScript bundle only**. Anything that
lands in the native binary — native modules, `AndroidManifest`, icons, the splash
image, permission strings — is baked at build time and is invisible to an update.

Adding a dependency is the case people get wrong. A pure-JS package is OTA-able; a
package with native code is not. If it appears in `expo prebuild`'s Gradle output or
has an `android/` directory, build an APK.

---

## 2. OTA update (JS-only changes)

### Publish

```sh
cd mobile
npx eas-cli update --channel preview --message "what changed" --non-interactive
```

Or the package script: `npm run ota -- "what changed"`.

That's the whole thing. It bundles the current **working tree** (not HEAD — see the
gotcha below), uploads it, and points the `preview` channel at it for both android and
ios. Output to check:

```
Branch      preview
Runtime     0.1.0
Platform    android, ios
Update group  f7f94790-c417-43ff-9f68-56a6486b7133
```

### How the phone picks it up

Configured in `mobile/app.json`:

```json
"runtimeVersion": { "policy": "appVersion" },
"updates": {
  "url": "https://u.expo.dev/1f4b99b6-e065-482b-a542-41a09e4927e2",
  "requestHeaders": { "expo-channel-name": "preview" },
  "checkAutomatically": "ON_LOAD",
  "fallbackToCacheTimeout": 3000
}
```

- `ON_LOAD` — it checks at every cold start, waits up to **3s**, then falls back to the
  cached bundle and finishes the download in the background. So: **first launch after
  publishing usually still shows the old UI; the second launch has the new one.** Not a
  bug. Force-close and reopen twice before concluding the update didn't land.
- The app calls no `expo-updates` API itself — there is no in-app "check for updates"
  button and no reload prompt. Delivery is entirely the automatic check.
- `runtimeVersion` follows `expo.version` (`0.1.0`). An installed APK only accepts
  updates published at the **same** runtime version. **Bumping `expo.version` orphans
  every installed APK** — they will silently stop seeing updates until users install a
  new APK. Don't bump it casually; when you do, ship an APK in the same breath.

### Channels

`preview` is the only channel in use. `mobile/eas.json` also declares `production`, but
nothing is built or published against it. `preview` builds are
`distribution: internal`, `buildType: apk` — sideloading, not Play Store.

### Gotchas

- **It bundles the working tree, not the commit.** Uncommitted edits go out; committed-
  but-unsaved-in-editor ones don't. Commit first, publish second, so the update and the
  repo agree.
- **EAS's own output may report the wrong commit hash** (it has printed the previous
  HEAD). Cosmetic — trust the update group ID, not the commit line.
- **`npx eas-cli build` is never used here.** APKs come from GitHub Actions (§3); the
  EAS free-tier build queue is far slower.
- Requires an authenticated `eas-cli` (`npx eas-cli whoami`). Project ID
  `1f4b99b6-e065-482b-a542-41a09e4927e2`, slug `agent-sandbox`.

---

## 3. APK build (GitHub Actions)

Workflow: `.github/workflows/mobile-apk.yml`. GitHub's runners have the Android SDK and
Java preinstalled, which is why this beats the EAS queue.

### Triggering

- **Automatic** on any push to `main` touching `mobile/**` or the workflow file. Every
  mobile commit therefore produces an APK whether you wanted one or not.
- **Manual** via `workflow_dispatch` — the Actions tab, or `gh workflow run mobile-apk.yml`.
- `concurrency: cancel-in-progress` — a newer push kills the older run.

### What it does

1. `actions/setup-node@v4` (Node 22, npm cache keyed on `mobile/package-lock.json`),
   `setup-java@v4` (Temurin 17), `gradle/actions/setup-gradle@v4`.
2. `npm ci` in `mobile/`.
3. `npx expo prebuild --platform android --no-install` — generates `mobile/android/`
   from `app.json`. The native project is **not** checked in; it is regenerated every
   run, so `app.json` is the single source of truth for anything native.
4. `./gradlew :app:assembleRelease` with:
   - `-PreactNativeArchitectures=arm64-v8a` — arm64 only. Every modern phone is arm64;
     skipping the other three ABIs roughly halves native compile time and shrinks the
     APK. It will **not** run on an x86 emulator.
   - `-x lintVitalRelease -x lintVitalAnalyzeRelease` — lint OOMs the runner's
     Metaspace and adds minutes for zero value on a sideloaded build.
   - `GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g`, `--no-daemon`.
5. Uploads `mobile/android/app/build/outputs/apk/release/app-release.apk` as artifact
   **`agent-sandbox-apk`**, 30-day retention. Timeout 30 min.

### Signing

Release is signed with **Expo's checked-in debug keystore** — deliberate, and fine for
sideloaded test builds. The important property is that the signature is *stable across
runs*, so a new APK installs over the old one without an uninstall.

It also means: this APK **cannot go to the Play Store**, and if you ever introduce a
real upload keystore, existing installs will need an uninstall/reinstall.

### Installing

```sh
gh run download --name agent-sandbox-apk        # latest run
adb install -r app-release.apk
```

Or download the artifact zip from the run page and open it on the phone (Android will
ask to allow installs from that source). `-r` reinstalls in place and keeps app data —
including the keychain entry, so you stay signed in.

### iOS

There is no iOS build pipeline. OTA updates are published for `ios` too (the channel
covers both platforms), but no one is producing an IPA — iOS is Expo Go / a local
`expo run:ios` only. An `ios` section exists in `app.json` (bundle id
`dev.ajeethkumar.agentsandbox`, photo/camera usage strings) so the build is ready
whenever someone wires it up.

---

## 4. Before you ship either

```sh
cd mobile && npx tsc --noEmit     # or: npm run typecheck
```

There is no mobile test suite and no mobile job in `.github/workflows/ci.yml` — the
typecheck is the whole gate, so don't skip it. Run the root `npm test` too if the change
touched anything shared with the controller (wire types, `format.ts` logic mirrored from
`web/src/lib/lifecycle.ts`).

Sequence for a normal JS change:

```sh
cd mobile && npx tsc --noEmit
cd .. && git add -A && git commit -m "mobile: ..." && git push origin main
cd mobile && npx eas-cli update --channel preview --message "..." --non-interactive
```

The push also fires an APK build. Harmless, and occasionally useful.

---

## 5. App anatomy

### Stack

Expo SDK 54, React Native 0.81.5, React 19.1, expo-router 6 (file-based),
TypeScript 5.9, new architecture **on** (`newArchEnabled: true`).

Identity: name **Agent Sandbox**, slug `agent-sandbox`, scheme `asb://`, package /
bundle id `dev.ajeethkumar.agentsandbox`, version `0.1.0`, portrait-only,
`userInterfaceStyle: automatic` (follows system light/dark).

Config plugins: `expo-router`, `expo-secure-store`, `expo-font`, `expo-asset`.

**Deliberately absent — do not reach for these:**

- **no `react-native-reanimated`** — all motion is the RN `Animated` API. Anything
  written against reanimated's `useSharedValue`/`withSpring` will not compile.
- **no `react-native-svg`** — no vector drawing. Meters, the brand mark and the splash
  are composed from `View`s, borders and radii. Icons are Feather via
  `@expo/vector-icons` (wrapped in `src/components/ui/Icon.tsx`).
- **no FlashList** — the transcript uses a plain `ScrollView`.
- **no push notifications** — the spec's `expo-notifications` plan is unbuilt. Settings →
  Notifications configures the *server's* webhook (ntfy/Slack) instead.

### Layout

```
mobile/
  app/                       expo-router routes
    _layout.tsx              splash hold, font load, theme + auth providers, AnimatedSplash
    index.tsx  welcome.tsx  sign-in.tsx  sign-up.tsx  connect-server.tsx  github-auth.tsx
    booting.tsx  new.tsx     (new.tsx is a bottom-sheet modal: delegate a task)
    (tabs)/                  home · fleet · activity · settings
    box/[name].tsx           the thread — SSE stream, vitals strip, composer, docks
    settings/                account, accounts, admin, api-keys, connect, devices,
                             mcp, notifications, skills
  src/
    components/              BoxCard, Composer, TranscriptView, TurnRail, PlanBoard,
                             QuestionCard, RunSummary, WakingCard, DiffText,
                             MarkdownLite, AnimatedSplash, SettingsScreen
      sheets/                BoxActionsSheet, ChangesSheet, PrSheet
      ui/                    AppText(T), Button, ArmButton, Card, Field, Icon, Sheet,
                             Skeleton, StatePill, UsageMeter, WorkingDot, Motion, BrandMark
    hooks/useFleet.ts        the fleet poll
    lib/                     api, config, sse, format, trace, question, activity,
                             mention, planTasks, slash, transcript-tools, pending-delegate
    state/auth.tsx           auth gate + session
    theme/                   tokens.ts (palette, radius, state colors), ThemeContext.tsx
  assets/                    icon.png, adaptive-icon.png, splash-icon.png
  scripts/                   oklch-to-hex.js (ports the web tokens)
```

### Auth and storage

Header-only `Authorization: Bearer …`; nothing is ever put in a URL. Mutations also send
`X-Requested-With` (the CSRF proof for cookie sessions on the web; harmless here).

`src/lib/config.ts` keeps the server URL (`asb-server-url`) and credential
(`asb-bearer`) in **expo-secure-store** — Android Keystore / iOS Keychain — cached in
memory after `loadConfig()`. Default server
`https://agent-sandbox.ajeethkumar.dev`, overridable via "Connect to your own server".

Two modes:

- **SaaS** — username + password; on success the app mints a *device-scoped* `asb_` API
  key (visible as "Android · Agent Sandbox app" under Settings → API keys). Revoking
  that key signs the device out.
- **Self-host** — server URL + operator token.

### Realtime

`src/lib/sse.ts` implements SSE over `XMLHttpRequest`, because RN's `fetch` has no
streaming body and `EventSource` can't set an auth header. Byte-offset frames
(`snapshot | append | reset | state | done`), `Last-Event-ID` resume on reconnect and
after backgrounding, 3s poll fallback once `done` arrives.

### Shared code

The wire types in `src/lib/api.ts` mirror `web/src/lib/api.ts` — same routes, same
shapes. `src/lib/trace.ts` and `src/lib/question.ts` are copied **verbatim** from the
server/web (pure, dependency-free); re-copy them when upstream changes. The resource-
usage helpers at the bottom of `src/lib/format.ts` mirror `web/src/lib/lifecycle.ts` for
the same reason — mobile has no import path into `web/`.

There is no shared package. Divergence is caught by review, not by the compiler, so
when you touch one side, search the other.

### Design language

Ported 1:1 from `web/DESIGN.md`: the oklch palette converted to hex by
`scripts/oklch-to-hex.js`, the Inter / Hedvig Letters Serif / Geist Mono trio (bundled,
not fetched), the type scale, the six functional state colours, and the arm-to-confirm
pattern for destructive actions. `web/DESIGN.md` remains the source of truth for
anything visual — including on the phone.

### Not in v1, by design

In-app code editing, push notifications, run history beyond the device-local Activity
feed, a tablet layout, offline beyond the last cached snapshot.
