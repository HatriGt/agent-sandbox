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

// splash-icon.png — frame ZERO of AnimatedSplash, pixel-matched to its final
// composition (108px box, 26px corner radius, 6px stroke, 34px orb, 30px corner
// notch, 13px spark, faint halo ring) so the native splash → in-app animation
// handoff is seamless: the static image simply comes alive.
function splashSvg() {
  const canvas = 1024;
  const c = canvas / 2;
  // AnimatedSplash renders the mark at S=108 inside imageWidth=200 → scale the
  // 108-box geometry so the box is 108/200 of the canvas.
  const k = canvas / 200;
  const S = 108 * k;
  const r = 26 * k;
  const stroke = 6 * k;
  const x0 = c - S / 2;
  const y0 = c - S / 2;
  const notch = 30 * k;
  return `
  <svg width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="orb" cx="38%" cy="34%" r="75%">
        <stop offset="0%" stop-color="#b8d4ff"/>
        <stop offset="45%" stop-color="#75a9ff"/>
        <stop offset="100%" stop-color="#2d69de"/>
      </radialGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#75a9ff" stop-opacity="0.45"/>
        <stop offset="60%" stop-color="#75a9ff" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="#75a9ff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <!-- soft glow behind the orb -->
    <circle cx="${c}" cy="${c}" r="${96 * k}" fill="url(#glow)"/>
    <!-- faint halo ring (the animation expands this); kept inside the canvas so it never clips -->
    <circle cx="${c}" cy="${c}" r="${88 * k}" fill="none" stroke="#75a9ff" stroke-opacity="0.25" stroke-width="${1.5 * k}"/>
    <!-- rounded frame with the top-right corner open (start after the gap, wrap
         around, stop before it) -->
    <path fill="none" stroke="#e8e8ea" stroke-width="${stroke}" stroke-linecap="round"
      d="M ${x0 + S - notch} ${y0}
         H ${x0 + r}
         A ${r} ${r} 0 0 0 ${x0} ${y0 + r}
         V ${y0 + S - r}
         A ${r} ${r} 0 0 0 ${x0 + r} ${y0 + S}
         H ${x0 + S - r}
         A ${r} ${r} 0 0 0 ${x0 + S} ${y0 + S - r}
         V ${y0 + notch}"/>
    <!-- the agent orb, dead center -->
    <circle cx="${c}" cy="${c}" r="${17 * k}" fill="url(#orb)"/>
    <circle cx="${c - 5 * k}" cy="${c - 6 * k}" r="${5 * k}" fill="#ffffff" opacity="0.55"/>
    <!-- the spark sitting in the gap -->
    <circle cx="${x0 + S - 6 * k}" cy="${y0 + 6 * k}" r="${6.5 * k}" fill="#75a9ff"/>
  </svg>`;
}

await sharp(Buffer.from(splashSvg())).png().toFile(path.join(assets, "splash-icon.png"));

console.log("wrote icon.png, adaptive-icon.png, splash-icon.png");
