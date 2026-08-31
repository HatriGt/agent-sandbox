import { getMe } from "@/lib/auth";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accounts } from "@/components/Accounts";
import { McpServers } from "@/components/McpServers";
import { Skills } from "@/components/Skills";

/**
 * Integrations: what every sandbox is given — GitHub identities and MCP servers. One column, two
 * sections, each a plain list with its controls in its own header row. No tiles, no explanatory
 * paragraphs; the rows are the content and every row is editable where it stands. Data paints
 * from the cache immediately and refreshes behind.
 */
export function Integrations({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
          <ArrowLeft className="size-4" />
          Machines
        </Button>
        <header className="mb-7">
          <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Integrations</h1>
          <p className="text-muted-foreground mt-0.5 text-meta">{getMe()?.mode === "saas" ? "Yours alone — given only to your machines, encrypted at rest." : "Given to every sandbox on its next run or turn. Stored on your server."}</p>
        </header>
        <div className="flex flex-col gap-10">
          <section aria-labelledby="gh-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="gh-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
                GitHub accounts
              </h2>
              <span className="text-muted-foreground text-meta">clone · read PRs · push</span>
            </div>
            <Accounts embedded />
          </section>
          <Skills />
          <McpServers />
        </div>
      </div>
    </div>
  );
}
