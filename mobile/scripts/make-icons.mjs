// Generates app icon, adaptive icon foreground, and splash icon from one SVG
// design: a "sandbox" — rounded container with a glowing agent orb inside,
// on a deep radial-gradient field. Run: node scripts/make-icons.mjs
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, "..", "assets");

// The mark alone (no background) — used for adaptive foreground and splash.
// Canvas 1024, mark centered. Blue = the app's `live` color family.
function markSvg({ box = "#f4f4f6", canvas = 1024, scale = 1 }) {
  const c = canvas / 2;
  const s = scale;
  return `
  <svg width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="orb" cx="38%" cy="34%" r="75%">
        <stop offset="0%" stop-color="#b8d4ff"/>
        <stop offset="45%" stop-color="#75a9ff"/>
        <stop offset="100%" stop-color="#2d69de"/>
      </radialGradient>
      <radialGradient id="halo" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#75a9ff" stop-opacity="0.55"/>
        <stop offset="60%" stop-color="#75a9ff" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="#75a9ff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="frame" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${box}"/>
        <stop offset="100%" stop-color="${box}" stop-opacity="0.72"/>
      </linearGradient>
    </defs>
    <!-- soft glow behind everything -->
    <circle cx="${c}" cy="${c}" r="${340 * s}" fill="url(#halo)"/>
    <!-- the sandbox: rounded container, open at the top-right corner (a gap =
         the agent can leave / results come out) -->
    <path fill="none" stroke="url(#frame)" stroke-width="${58 * s}" stroke-linecap="round"
      d="M ${c + 118 * s} ${c - 236 * s}
         a ${118 * s} ${118 * s} 0 0 1 ${118 * s} ${118 * s}
         v ${236 * s}
         a ${118 * s} ${118 * s} 0 0 1 ${-118 * s} ${118 * s}
         h ${-236 * s}
         a ${118 * s} ${118 * s} 0 0 1 ${-118 * s} ${-118 * s}
         v ${-236 * s}
         a ${118 * s} ${118 * s} 0 0 1 ${118 * s} ${-118 * s}
         h ${118 * s}"/>
    <!-- the agent orb -->
    <circle cx="${c}" cy="${c}" r="${92 * s}" fill="url(#orb)"/>
    <circle cx="${c - 30 * s}" cy="${c - 34 * s}" r="${26 * s}" fill="#ffffff" opacity="0.5"/>
    <!-- the spark escaping through the gap -->
    <circle cx="${c + 236 * s}" cy="${c - 236 * s}" r="${34 * s}" fill="#75a9ff"/>
    <circle cx="${c + 236 * s}" cy="${c - 236 * s}" r="${54 * s}" fill="none" stroke="#75a9ff" stroke-opacity="0.35" stroke-width="${10 * s}"/>
  </svg>`;
}

// Full icon: gradient field + vignette + mark.
function iconSvg() {
  const canvas = 1024;
  return `
  <svg width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="field" cx="32%" cy="24%" r="110%">
        <stop offset="0%" stop-color="#23232c"/>
        <stop offset="55%" stop-color="#141419"/>
        <stop offset="100%" stop-color="#0a0a0e"/>
      </radialGradient>
      <radialGradient id="tint" cx="70%" cy="80%" r="80%">
        <stop offset="0%" stop-color="#2d69de" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#2d69de" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${canvas}" height="${canvas}" fill="url(#field)"/>
    <rect width="${canvas}" height="${canvas}" fill="url(#tint)"/>
  </svg>`;
}

const bg = await sharp(Buffer.from(iconSvg())).png().toBuffer();
const mark = await sharp(Buffer.from(markSvg({ scale: 0.92 }))).png().toBuffer();

// icon.png — full-bleed square (iOS masks its own corners)
await sharp(bg).composite([{ input: mark }]).png().toFile(path.join(assets, "icon.png"));

// adaptive-icon.png — mark only, smaller (Android masks aggressively; keep
// content inside the middle ~66%)
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp(Buffer.from(markSvg({ scale: 0.62 }))).png().toBuffer() }])
  .png()
  .toFile(path.join(assets, "adaptive-icon.png"));

// splash-icon.png — mark on transparent, matches the in-app animated splash
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp(Buffer.from(markSvg({ scale: 0.8 }))).png().toBuffer() }])
  .png()
  .toFile(path.join(assets, "splash-icon.png"));

console.log("wrote icon.png, adaptive-icon.png, splash-icon.png");
