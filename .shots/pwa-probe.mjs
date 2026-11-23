// Proves the installable-app pieces against a controller serving the BUILT bundle (web/dist):
//   node .shots/pwa-probe.mjs [--base=http://127.0.0.1:8787] [--out=.shots/pwa]
// Checks the manifest's content-type, that the service worker registers and caches the shell, that
// a reload while offline still boots the console, and shoots the Account page's Install section in
// both schemes. Token: ASB_DEV_TOKEN (default devtoken123).
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const base = arg("base", "http://127.0.0.1:8787");
const out = arg("out", ".shots/pwa");
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const fails = [];
const check = (ok, what) => (ok ? console.log("ok   ", what) : (fails.push(what), console.log("FAIL ", what)));

// 1. The manifest and the worker are served with the right types and no long cache on the worker.
for (const [path, type] of [
  ["/dashboard/manifest.webmanifest", "application/manifest+json"],
  ["/dashboard/sw.js", "javascript"],
  ["/dashboard/icons/icon-512.png", "image/png"],
  ["/dashboard/icons/maskable-512.png", "image/png"],
  ["/dashboard/icons/apple-touch-icon.png", "image/png"],
]) {
  const r = await fetch(base + path);
  check(r.ok && (r.headers.get("content-type") || "").includes(type), `${path} → ${r.status} ${r.headers.get("content-type")}`);
  if (path.endsWith("sw.js")) check(/no-cache/.test(r.headers.get("cache-control") || ""), `sw.js cache-control: ${r.headers.get("cache-control")}`);
}
const manifest = await (await fetch(base + "/dashboard/manifest.webmanifest")).json();
check(manifest.start_url === "/dashboard/" && manifest.display === "standalone", "manifest start_url + display");

for (const dark of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => localStorage.setItem("asb-token", t), token);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/dashboard/account", { waitUntil: "load" });

  // 2. The worker registers from the bundle and owns the console scope; the shell is in its cache.
  const sw = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error("sw timeout")), 8000))]);
    // Give the install step a moment to put the shell.
    for (let i = 0; i < 20; i++) {
      const names = await caches.keys();
      const shell = names.find((n) => n.startsWith("asb-shell-"));
      if (shell && (await (await caches.open(shell)).match("/dashboard/"))) return { scope: reg.scope, names };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { scope: reg.scope, names: await caches.keys(), noShell: true };
  });
  check(sw.scope.endsWith("/dashboard/") && !sw.noShell, `${dark ? "dark" : "light"}: worker scope ${sw.scope}, caches ${sw.names.join(",")}`);
  const themeColor = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute("content"));
  check(/^oklch\(/.test(themeColor || ""), `${dark ? "dark" : "light"}: theme-color follows the theme (${themeColor})`);
  const linked = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href"));
  check(linked === "/dashboard/manifest.webmanifest", "manifest linked from the shell");

  // 3. The Install section on the Account page, clipped.
  await page.waitForTimeout(800);
  const section = page.locator('section[aria-labelledby="install-h"]');
  await section.scrollIntoViewIfNeeded();
  const box = await section.boundingBox();
  check(!!box, "install section renders");
  const file = `${out}/account-install-${dark ? "dark" : "light"}.png`;
  await page.screenshot({ path: file, clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 24), width: Math.min(1280, box.width + 48), height: box.height + 48 } });
  console.log("saved", file);
  await page.screenshot({ path: `${out}/account-${dark ? "dark" : "light"}.png` });
  // Headless Chromium never offers an install prompt; a synthetic event shows the button state.
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => {};
    e.userChoice = Promise.resolve({ outcome: "dismissed", platform: "" });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(400);
  const btn = page.getByRole("button", { name: "Install app" });
  check((await btn.count()) === 1, `${dark ? "dark" : "light"}: the Install app button appears once the browser offers a prompt`);
  const box2 = await section.boundingBox();
  await page.screenshot({ path: `${out}/account-install-button-${dark ? "dark" : "light"}.png`, clip: { x: Math.max(0, box2.x - 24), y: Math.max(0, box2.y - 24), width: Math.min(1280, box2.width + 48), height: box2.height + 48 } });

  // 4. Offline: the console still boots from the worker's shell + asset cache.
  await ctx.setOffline(true);
  const offlineErrors = [];
  page.on("pageerror", (e) => offlineErrors.push(String(e)));
  const nav = await page.goto(base + "/dashboard/account", { waitUntil: "load", timeout: 15000 }).catch((e) => ({ err: e.message }));
  // Booted = the console's own chrome drew (the sidebar and its "can't reach the controller" state),
  // not the browser's offline page or the pre-paint skeleton.
  await page.waitForTimeout(1500);
  const booted = nav && !nav.err && (await page.getByText("Fleet view").count()) > 0 && (await page.getByText(/offline|Reconnecting|Can't reach/).count()) > 0;
  check(booted, `${dark ? "dark" : "light"}: offline reload boots the console (${nav?.err ?? "ok"})`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/offline-${dark ? "dark" : "light"}.png` });
  if (!booted) console.log("offline body:", (await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n+/g, " | "), "\noffline errors:", offlineErrors.slice(0, 3).join(" ; "));
  await ctx.setOffline(false);
  if (errors.length) console.log("page errors:", errors.slice(0, 5).join("\n"));
  await ctx.close();
}
await browser.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
