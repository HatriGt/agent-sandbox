// Generate minimal on-theme PNG assets (icon + splash logo) with no deps:
// raw RGBA -> zlib deflate -> hand-assembled PNG chunks.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, pixelFn) {
  // filter byte 0 per row + RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// The mark: a rounded "sandbox" square outline with a breathing dot inside —
// dark ink #18181b background (icon) / transparent (splash logo), fg #fafafa,
// dot in --live blue.
const BG = [0x18, 0x18, 0x1b, 255];
const FG = [0xfa, 0xfa, 0xfa, 255];
const LIVE = [0x75, 0xa9, 0xff, 255];

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
}

function mark(size, transparentBg) {
  const s = size;
  const m = s * 0.24; // outer margin of the box outline
  const w = s * 0.055; // stroke width
  const rad = s * 0.09;
  const dotR = s * 0.075;
  const dotCx = s / 2;
  const dotCy = s / 2;
  return png(s, s, (x, y) => {
    const outer = inRoundedRect(x, y, m, m, s - m, s - m, rad);
    const inner = inRoundedRect(x, y, m + w, m + w, s - m - w, s - m - w, Math.max(1, rad - w));
    const onStroke = outer && !inner;
    const onDot = (x - dotCx) ** 2 + (y - dotCy) ** 2 <= dotR * dotR;
    if (onDot) return LIVE;
    if (onStroke) return FG;
    return transparentBg ? [0, 0, 0, 0] : BG;
  });
}

const dir = path.join(__dirname, "..", "assets");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "icon.png"), mark(1024, false));
fs.writeFileSync(path.join(dir, "adaptive-icon.png"), mark(1024, true));
fs.writeFileSync(path.join(dir, "splash-icon.png"), mark(512, true));
console.log("wrote assets/icon.png, adaptive-icon.png, splash-icon.png");
