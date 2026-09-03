import React from "react";
import { View } from "react-native";
import { serverUrl } from "@/lib/config";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";

function Snippet({ title, code }: { title: string; code: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T variant="meta" weight="medium" tone="muted">
        {title}
      </T>
      <View style={{ backgroundColor: palette.trace, borderRadius: radius.lg, padding: 12 }}>
        <T variant="code" mono selectable style={{ color: palette.traceFg }}>
          {code}
        </T>
      </View>
    </View>
  );
}

/** IDE connect snippets — same peer-entry-point story as /dashboard/connect. */
export default function Connect() {
  const base = serverUrl();
  const mcpJson = `{
  "mcpServers": {
    "agent-sandbox": {
      "type": "http",
      "url": "${base}/mcp",
      "headers": { "Authorization": "Bearer <your asb_ key>" }
    }
  }
}`;
  return (
    <SettingsScreen title="Connect an IDE">
      <T variant="body" tone="muted">
        The dashboard, this app, any MCP client and plain curl are peers — same tools, same auth. Mint an
        API key under Settings → API keys, then:
      </T>
      <Snippet title="Cursor / Claude Code / Zed (mcp.json)" code={mcpJson} />
      <Snippet
        title="Claude Code (one-liner)"
        code={`claude mcp add --transport http agent-sandbox ${base}/mcp \\\n  --header "Authorization: Bearer <key>"`}
      />
      <Snippet
        title="Plain curl"
        code={`curl -H "Authorization: Bearer <key>" \\\n  ${base}/fleet.json`}
      />
      <T variant="micro" tone="faint">
        MCP tools: delegate · status · resume · teardown · pool_status · monitor · watch · ask · gh_token_add
      </T>
    </SettingsScreen>
  );
}
