import * as si from "simple-icons";
import { Globe, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Brand glyphs for MCP servers, guessed from the server's name/command/url (atlassian, slack,
 * postgres…), drawn from simple-icons in the brand's own colour on a tinted tile. Unknown servers
 * fall back to a transport glyph. Pure lookup; no network.
 */
type Icon = { path: string; hex: string; title: string };
// Keys are looked up loosely: simple-icons drops trademarks now and then, and a missing brand should
// fall back to the transport glyph rather than break the build.
const BRANDS: Array<[RegExp, string]> = [
  [/atlassian|jira|confluence/i, "siAtlassian"],
  [/slack/i, "siSlack"],
  [/github/i, "siGithub"],
  [/gitlab/i, "siGitlab"],
  [/bitbucket/i, "siBitbucket"],
  [/postgres|pg\b/i, "siPostgresql"],
  [/mysql|mariadb/i, "siMysql"],
  [/sqlite/i, "siSqlite"],
  [/mongo/i, "siMongodb"],
  [/redis/i, "siRedis"],
  [/supabase/i, "siSupabase"],
  [/snowflake/i, "siSnowflake"],
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
  [/playwright/i, "siPlaywright"],
  [/puppeteer/i, "siPuppeteer"],
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
];

export function brandFor(hint: string): Icon | null {
  for (const [re, key] of BRANDS) {
    if (re.test(hint)) {
      const icon = (si as unknown as Record<string, Icon | undefined>)[key];
      if (icon?.path) return icon;
    }
  }
  return null;
}

export function BrandIcon({ hint, transport, className }: { hint: string; transport?: "stdio" | "http" | "sse"; className?: string }) {
  const b = brandFor(hint);
  if (!b) {
    const Fallback = transport === "stdio" ? Terminal : Globe;
    return (
      <span className={cn("bg-muted text-foreground grid size-9 shrink-0 place-items-center rounded-lg", className)}>
        <Fallback className="size-4" aria-hidden />
      </span>
    );
  }
  // Very dark brand colours vanish on the dark theme; lift them onto a light tile instead.
  const dark = parseInt(b.hex.slice(0, 2), 16) + parseInt(b.hex.slice(2, 4), 16) + parseInt(b.hex.slice(4, 6), 16) < 120;
  return (
    <span
      className={cn("grid size-9 shrink-0 place-items-center rounded-lg", dark && "dark:bg-white", className)}
      style={{ background: dark ? undefined : `#${b.hex}1f` }}
      title={b.title}
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path d={b.path} fill={dark ? undefined : `#${b.hex}`} className={dark ? "fill-foreground dark:fill-black" : undefined} />
      </svg>
    </span>
  );
}
