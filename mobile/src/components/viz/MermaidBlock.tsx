import React from "react";
import { ActivityIndicator, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useTheme } from "@/theme/ThemeContext";
import type { Palette } from "@/theme/tokens";
import { T } from "../ui/AppText";
import { ExpandAction, VizFullscreen } from "./Fullscreen";

/**
 * Raw ```mermaid fences that are not flowcharts our parser reads (state, class, er, gantt, pie,
 * mindmap, timeline…) → mermaid itself, rendered in a sandboxed WebView from the CDN and themed
 * from the palette. Load/parse/render failure (offline, bad syntax, 12s timeout) → `fallback`
 * (the raw code block), the same contract as web's MermaidSvg.
 */

const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
const TIMEOUT_MS = 12_000;

/** 6-digit hex only: mermaid's colour maths cannot read `#rrggbbaa`. */
const solid = (c: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback);

function html(source: string, p: Palette, dark: boolean): string {
  const fg = solid(p.foreground, dark ? "#ffffff" : "#111111");
  const card = solid(p.card, dark ? "#111111" : "#ffffff");
  const muted = solid(p.muted, card);
  const mutedFg = solid(p.mutedForeground, fg);
  const theme = {
    darkMode: dark,
    background: card,
    primaryColor: muted,
    primaryTextColor: fg,
    primaryBorderColor: mutedFg,
    lineColor: mutedFg,
    secondaryColor: card,
    tertiaryColor: card,
    textColor: fg,
    mainBkg: muted,
    nodeBorder: mutedFg,
    fontFamily: "-apple-system, Roboto, sans-serif",
    fontSize: "13px",
  };
  // The source travels as JSON so no fence content can break out of the script.
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4">
<style>html,body{margin:0;padding:0;background:${card};}#d{padding:8px;}#d svg{max-width:none!important;height:auto;}</style>
<script src="${MERMAID_URL}" onerror="window.ReactNativeWebView.postMessage(JSON.stringify({error:'load'}))"></script></head>
<body><div id="d"></div><script>
(async function(){
  try {
    mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:"base",themeVariables:${JSON.stringify(theme)},sequence:{mirrorActors:false,useMaxWidth:false},flowchart:{useMaxWidth:false}});
    const r = await mermaid.render("m1", ${JSON.stringify(source)});
    const el = document.getElementById("d");
    el.innerHTML = r.svg;
    const svg = el.querySelector("svg");
    const b = svg.getBoundingClientRect();
    window.ReactNativeWebView.postMessage(JSON.stringify({w:Math.ceil(b.width)+16,h:Math.ceil(b.height)+16}));
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({error:String(e && e.message || e)}));
  }
})();
</script></body></html>`;
}

function MermaidWeb({ source, height, onSize, onError }: { source: string; height?: number; onSize?: (s: { w: number; h: number }) => void; onError: () => void }) {
  const { palette, dark } = useTheme();
  const doc = React.useMemo(() => html(source, palette, dark), [source, palette, dark]);
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data) as { w?: number; h?: number; error?: string };
      if (m.error || !m.h || !m.w) onError();
      else onSize?.({ w: m.w, h: m.h });
    } catch {
      onError();
    }
  };
  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html: doc }}
      onMessage={onMessage}
      // Script loads are not navigations; any link mermaid draws must never navigate the frame.
      onShouldStartLoadWithRequest={(r) => r.url === "about:blank" || r.url.startsWith("data:")}
      onError={onError}
      onHttpError={onError}
      javaScriptEnabled
      setSupportMultipleWindows={false}
      scrollEnabled={height === undefined}
      style={{ backgroundColor: "transparent", height }}
      containerStyle={{ backgroundColor: "transparent" }}
    />
  );
}

export function MermaidBlock({ source, label, fallback }: { source: string; label: string; fallback: React.ReactNode }) {
  const { palette } = useTheme();
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [full, setFull] = React.useState(false);
  React.useEffect(() => {
    setState("loading");
    setSize(null);
  }, [source]);
  React.useEffect(() => {
    if (state !== "loading") return;
    const t = setTimeout(() => setState("error"), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [state, source]);
  if (state === "error") return <>{fallback}</>;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: size ? Math.min(size.h, 480) : 120 }}>
        <MermaidWeb
          key={source}
          source={source}
          height={size ? Math.min(size.h, 480) : 120}
          onSize={(s) => {
            setSize(s);
            setState("ready");
          }}
          onError={() => setState("error")}
        />
        {state === "loading" ? (
          <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: palette.card }}>
            <ActivityIndicator color={palette.mutedForeground} />
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <T variant="micro" tone="faint" style={{ flex: 1 }}>
          {label} · drawn by mermaid
        </T>
        {state === "ready" ? <ExpandAction onPress={() => setFull(true)} /> : null}
      </View>
      <VizFullscreen visible={full} onClose={() => setFull(false)} title={label}>
        {(zoom) =>
          size ? (
            <View style={{ width: size.w * zoom, height: size.h * zoom }}>
              <View style={{ width: size.w, height: size.h, transform: [{ scale: zoom }], transformOrigin: "top left" }}>
                <MermaidWeb source={source} height={size.h} onError={() => setFull(false)} />
              </View>
            </View>
          ) : null
        }
      </VizFullscreen>
    </View>
  );
}
