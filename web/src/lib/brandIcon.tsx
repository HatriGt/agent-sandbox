import { siAirtable, siAnthropic, siAsana, siAtlassian, siBitbucket, siBrave, siCloudflare, siDatadog, siDiagramsdotnet, siDiscord, siDocker, siFigma, siGithub, siGitlab, siGmail, siGooglechrome, siGoogledrive, siGrafana, siHubspot, siKubernetes, siLinear, siMongodb, siMysql, siNodedotjs, siNotion, siPerplexity, siPostgresql, siPuppeteer, siPython, siReddit, siRedis, siSap, siSentry, siSnowflake, siSqlite, siStripe, siSupabase, siTelegram, siTrello, siVercel, siYoutube, siZapier } from "simple-icons";
import { Globe, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Brand glyphs for MCP servers, guessed from the server's name/command/url (atlassian, linear,
 * postgres…), drawn from simple-icons in the brand's own colour — bare glyph, no tile. Brands whose
 * colour is near-black use the foreground colour so they survive the dark theme. Unknown servers
 * get a transport glyph in the muted colour. Pure lookup; no network.
 */
type Icon = { path: string; hex: string; title: string };
type Glyph = Icon;
const ICONS: Record<string, Glyph | undefined> = { siAirtable, siAnthropic, siAsana, siAtlassian, siBitbucket, siBrave, siCloudflare, siDatadog, siDiagramsdotnet, siDiscord, siDocker, siFigma, siGithub, siGitlab, siGmail, siGooglechrome, siGoogledrive, siGrafana, siHubspot, siKubernetes, siLinear, siMongodb, siMysql, siNodedotjs, siNotion, siPerplexity, siPostgresql, siPuppeteer, siPython, siReddit, siRedis, siSap, siSentry, siSnowflake, siSqlite, siStripe, siSupabase, siTelegram, siTrello, siVercel, siYoutube, siZapier };
// Looked up loosely: simple-icons drops trademarks now and then; a missing brand must fall back, not break.
const BRANDS: Array<[RegExp, string]> = [
  [/atlassian|jira|confluence|rovo/i, "siAtlassian"],
  [/slack/i, "siSlack"],
  [/github/i, "siGithub"],
  [/gitlab/i, "siGitlab"],
  [/bitbucket/i, "siBitbucket"],
  [/postgres|\bpg\b/i, "siPostgresql"],
  [/mysql|mariadb/i, "siMysql"],
  [/sqlite/i, "siSqlite"],
  [/mongo/i, "siMongodb"],
  [/redis/i, "siRedis"],
  [/supabase/i, "siSupabase"],
  [/snowflake/i, "siSnowflake"],
  [/\bsap\b|hana|abap|s4|cap-js|cds/i, "siSap"],
  [/linear/i, "siLinear"],
  [/notion/i, "siNotion"],
  [/sentry/i, "siSentry"],
  [/figma/i, "siFigma"],
  [/stripe/i, "siStripe"],
  [/vercel/i, "siVercel"],
  [/cloudflare/i, "siCloudflare"],
  [/docker/i, "siDocker"],
  [/kubernetes|k8s/i, "siKubernetes"],
  [/datadog/i, "siDatadog"],
  [/grafana/i, "siGrafana"],
  [/chrome|devtools|chromium/i, "siGooglechrome"],
  [/playwright/i, "siPlaywright"],
  [/puppeteer/i, "siPuppeteer"],
  [/draw\.?io|diagrams/i, "siDiagramsdotnet"],
  [/brave/i, "siBrave"],
  [/perplexity/i, "siPerplexity"],
  [/openai/i, "siOpenai"],
  [/anthropic|claude/i, "siAnthropic"],
  [/discord/i, "siDiscord"],
  [/telegram/i, "siTelegram"],
  [/trello/i, "siTrello"],
  [/asana/i, "siAsana"],
  [/airtable/i, "siAirtable"],
  [/hubspot/i, "siHubspot"],
  [/zapier/i, "siZapier"],
  [/google.?drive|gdrive/i, "siGoogledrive"],
  [/gmail/i, "siGmail"],
  [/youtube/i, "siYoutube"],
  [/reddit/i, "siReddit"],
  [/\bnpx\b|\bnode\b|npm/i, "siNodedotjs"],
  [/python|\bpip\b|uvx?/i, "siPython"],
];

export function brandFor(hint: string): Icon | null {
  for (const [re, key] of BRANDS) {
    if (re.test(hint)) {
      const icon = ICONS[key];
      if (icon?.path) return icon;
    }
  }
  return null;
}

function luminance(hex: string) {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function BrandGlyph({ hint, transport, className }: { hint: string; transport?: "stdio" | "http" | "sse"; className?: string }) {
  const b = brandFor(hint);
  if (!b) {
    const Fallback = transport === "stdio" ? Terminal : Globe;
    return <Fallback className={cn("text-muted-foreground size-4 shrink-0", className)} aria-hidden />;
  }
  const lum = luminance(b.hex);
  // Near-black brands (GitHub, Vercel, Notion…) take the theme's foreground; near-white ones too.
  const themed = lum < 0.18 || lum > 0.9;
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0", themed && "fill-foreground", className)} aria-hidden data-brand={b.title}>
      <path d={b.path} fill={themed ? undefined : `#${b.hex}`} />
    </svg>
  );
}
