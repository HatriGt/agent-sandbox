# The console as an installable app

The dashboard is a progressive web app: a browser can install it as its own window with an icon
on the desktop, dock or home screen, and the installed app opens even when the controller is
unreachable (it draws the console and its "can't reach the controller · retrying" state instead of
the browser's offline page).

## Pieces

| Piece | Where | Served at |
| --- | --- | --- |
| Web manifest | `web/public/manifest.webmanifest` | `/dashboard/manifest.webmanifest` |
| Icons (192, 512, maskable 512, Apple touch 180) | `web/public/icons/` | `/dashboard/icons/*` |
| Service worker template | `web/sw/sw.js` | `/dashboard/sw.js` (stamped by the build) |
| Client plumbing | `web/src/lib/pwa.ts` | registration, install prompt, standalone detection |
| Install row | `web/src/components/Account.tsx` (`InstallSettings`) | Account → Install |

The manifest's `start_url` is `/dashboard/`, its `scope` is `/` so a sign-out that lands on
`/signin` stays in the app window, and `display` is `standalone`. `short_name` is "Sandbox" because
home-screen labels cut off past about twelve characters.

`index.html` links the manifest and carries the iOS tags (`apple-mobile-web-app-*`, a PNG touch
icon; iOS ignores the manifest's display mode). The `theme-color` meta follows the active theme:
the pre-paint script sets the scheme's tone, `applyTheme` in `lib/theme.ts` the exact page colour,
so the installed app's title bar matches the page.

## The service worker

Scope `/dashboard/` only. Every data route lives at the origin root (`/fleet.json`, `/watch.sse`,
`/artifact`, …), so the worker never sees a bearer-guarded response and nothing private is ever
cached. Within its scope:

- **Navigations** are network first. A deploy is picked up on the next open; the cached shell
  answers only when the network is down.
- **`/dashboard/assets/*`** (content-hashed bundles) are cache first. At install the worker
  precaches the bundles the shell names, because the page that registered it fetched those before
  the worker existed; lazy chunks are kept as they are visited. The asset cache is trimmed past
  240 entries.
- **Everything else in scope** (icons, favicon, manifest) is stale-while-revalidate.

The build (`web/vite.config.ts`, plugin `asb-service-worker`) emits `dist/sw.js` with
`__BUILD_ID__` replaced by a hash of the bundle's file names and the template, so a deploy ships a
new worker (which drops the old shell cache on activate) and an identical rebuild ships the same
one. The worker file is not in `public/` on purpose: `npm run dev` runs without one, and
`registerServiceWorker` only registers in production builds.

The controller serves `sw.js` with `Cache-Control: no-cache` (it is not under `/assets/`), so the
browser's update check always sees the current worker. The app CSP already allows it
(`worker-src 'self'`; `manifest-src` falls back to `default-src 'self'`).

## Installing

- **Chrome and Edge** fire `beforeinstallprompt`; `lib/pwa.ts` keeps the event and the Account
  page's Install row shows an **Install app** button that opens the browser's dialog.
- **Safari** (macOS Sonoma+, iOS) and **Firefox** have no prompt API; the row tells the reader
  where the browser's own option lives (Add to Dock, Share → Add to Home Screen).
- Inside the installed app (`display-mode: standalone`) the row only confirms it.

## Checking it

`node .shots/pwa-icons.mjs` regenerates the PNG icons from `web/public/favicon.svg` (Playwright).

`node .shots/pwa-probe.mjs [--base=http://127.0.0.1:8787]` runs against a controller serving the
built bundle: content types of the manifest, worker and icons; worker scope and the precached
shell; the theme-colour meta; a reload with the network cut that still boots the console; the
Install row in both schemes, with and without a prompt. `test/pwa.test.ts` pins the manifest's
shape, the icon files and sizes, the shell's tags and the worker template's scope.
