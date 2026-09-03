// Convert the dashboard's oklch tokens to hex (sRGB, clamped) for React Native.
function oklchToHex(L, C, H, alpha) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const toSrgb = (c) => {
    c = Math.min(1, Math.max(0, c));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  const hex = (c) => Math.round(toSrgb(c) * 255).toString(16).padStart(2, "0");
  let out = `#${hex(r)}${hex(g)}${hex(bl)}`;
  if (alpha != null) out += Math.round(alpha * 255).toString(16).padStart(2, "0");
  return out;
}

const tokens = {
  light: {
    background: [0.992, 0.001, 286], foreground: [0.21, 0.006, 285.9],
    card: [1, 0, 0], popover: [1, 0, 0],
    primary: [0.21, 0.006, 285.9], primaryForeground: [0.985, 0, 0],
    secondary: [0.955, 0.002, 286.4], muted: [0.962, 0.002, 286.4],
    mutedForeground: [0.5, 0.016, 285.9], accent: [0.945, 0.003, 286.4],
    faint: [0.58, 0.012, 286],
    border: [0, 0, 0, 0.09], lineStrong: [0, 0, 0, 0.18], input: [0, 0, 0, 0.12],
    ring: [0.55, 0.19, 262], live: [0.52, 0.2, 262],
    attention: [0.82, 0.15, 78], attentionText: [0.5, 0.12, 62], attentionInk: [0.25, 0.05, 60],
    ok: [0.52, 0.14, 152], destructive: [0.55, 0.21, 27], sleep: [0.55, 0.16, 300],
    trace: [0.2, 0.006, 286], traceFg: [0.93, 0.003, 286],
  },
  dark: {
    background: [0.17, 0.005, 286], foreground: [0.95, 0.002, 286],
    card: [0.205, 0.005, 286], popover: [0.225, 0.006, 286],
    primary: [0.93, 0.002, 286], primaryForeground: [0.19, 0.005, 286],
    secondary: [0.27, 0.006, 286], muted: [0.255, 0.006, 286],
    mutedForeground: [0.7, 0.012, 286], accent: [0.29, 0.007, 286],
    faint: [0.62, 0.012, 286],
    border: [1, 0, 0, 0.09], lineStrong: [1, 0, 0, 0.2], input: [1, 0, 0, 0.14],
    ring: [0.72, 0.16, 262], live: [0.74, 0.15, 262],
    attention: [0.8, 0.15, 78], attentionText: [0.85, 0.12, 80], attentionInk: [0.22, 0.05, 60],
    ok: [0.74, 0.14, 155], destructive: [0.7, 0.19, 22], sleep: [0.76, 0.13, 300],
    trace: [0.13, 0.004, 286], traceFg: [0.9, 0.004, 286],
  },
};

for (const [mode, set] of Object.entries(tokens)) {
  console.log(`  ${mode}: {`);
  for (const [name, v] of Object.entries(set)) {
    console.log(`    ${name}: "${oklchToHex(v[0], v[1], v[2], v[3])}",`);
  }
  console.log(`  },`);
}
