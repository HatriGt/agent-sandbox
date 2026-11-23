/**
 * The installable-app files: the manifest the browser reads before offering "Install", and the
 * service worker template the build stamps. Both are static, so their shape is pinned here rather
 * than discovered in a browser after a deploy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WEB = resolve(import.meta.dirname, "..", "web");
const PUBLIC = join(WEB, "public");

const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
  shortcuts?: { url: string }[];
};

test("the manifest starts the app on the console, inside its scope, as a standalone window", () => {
  assert.equal(manifest.start_url, "/dashboard/");
  assert.ok(manifest.start_url.startsWith(manifest.scope), "start_url must be within scope");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.name && manifest.short_name.length <= 12, "short_name fits a home-screen label");
  for (const s of manifest.shortcuts ?? []) assert.ok(s.url.startsWith(manifest.scope), `shortcut ${s.url} is within scope`);
});

test("every icon the manifest names ships in the bundle, with a maskable one for Android", () => {
  const sizes = new Set<string>();
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith("/dashboard/"), `${icon.src} is served from the dashboard mount`);
    const file = join(PUBLIC, icon.src.replace(/^\/dashboard\//, ""));
    assert.ok(existsSync(file), `${icon.src} exists in web/public`);
    if (icon.type === "image/png") {
      // PNG header: width/height at bytes 16–24; the declared size must be the real one.
      const buf = readFileSync(file);
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} is the size it claims`);
    }
    sizes.add(`${icon.sizes}/${icon.purpose ?? "any"}`);
  }
  assert.ok(sizes.has("192x192/any") && sizes.has("512x512/any"), "Chromium wants 192 and 512 'any' icons");
  assert.ok(sizes.has("512x512/maskable"), "Android launchers want a maskable icon");
  assert.ok(existsSync(join(PUBLIC, "icons", "apple-touch-icon.png")), "iOS wants a PNG touch icon");
});

test("the shell links the manifest and the iOS tags", () => {
  const html = readFileSync(join(WEB, "index.html"), "utf8");
  assert.match(html, /<link rel="manifest" href="\/dashboard\/manifest\.webmanifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /<link rel="apple-touch-icon"[^>]*href="\/dashboard\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /<meta name="theme-color"/);
});

test("the service worker template is scoped to the console and stamped per build", () => {
  const sw = readFileSync(join(WEB, "sw", "sw.js"), "utf8");
  assert.ok(sw.includes('"__BUILD_ID__"'), "the build stamps the id");
  assert.ok(sw.includes('"/dashboard/"'), "the shell URL is the console");
  assert.ok(sw.includes('startsWith("/dashboard/assets/")'), "hashed assets are cache-first");
  // The data routes live at the origin root; the worker's code (comments aside) must never name one.
  const code = sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\.json|\.sse|\/artifact/.test(code), "no data route is named in the worker");
});
