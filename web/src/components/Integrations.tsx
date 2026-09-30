import { getMe } from "@/lib/auth";
import { SettingsPage, SettingsSection } from "@/components/ui/settings";
import { Accounts } from "@/components/Accounts";
import { McpServers } from "@/components/McpServers";
import { Providers } from "@/components/Providers";
import { RepoSetup } from "@/components/RepoSetup";
import { InboxIntake } from "@/components/InboxIntake";

/**
 * Integrations: what every sandbox is given — GitHub identities and MCP servers. One column, two
 * sections, each a plain list with its controls in its own header row. No tiles, no explanatory
 * paragraphs; the rows are the content and every row is editable where it stands. Data paints
 * from the cache immediately and refreshes behind.
 */
export function Integrations({ onBack }: { onBack: () => void }) {
  return (
    <SettingsPage
      title="Providers & Accounts"
      purpose={getMe()?.mode === "saas" ? "Yours alone — given only to your machines, encrypted at rest." : "Given to every sandbox on its next run or turn. Stored on your server."}
      back={{ label: "Machines", onClick: onBack, mobileOnly: true }}
    >
      <Providers />
      <SettingsSection id="gh" title="GitHub accounts" meta="clone · read PRs · push">
        <Accounts embedded />
      </SettingsSection>
      <McpServers />
      <RepoSetup />
      <InboxIntake />
    </SettingsPage>
  );
}
