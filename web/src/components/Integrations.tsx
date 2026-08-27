import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accounts } from "@/components/Accounts";
import { McpServers } from "@/components/McpServers";

/**
 * Integrations: everything a sandbox borrows from you — GitHub accounts (who the agent is on GitHub)
 * and MCP servers (which tools it can call). Both live on your server, configured once, used by every
 * run.
 */
export function Integrations({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-7 md:px-8 md:py-9">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
          <ArrowLeft className="size-4" />
          Machines
        </Button>
        <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Integrations</h1>
        <p className="text-muted-foreground mt-2 max-w-[68ch] text-body">
          What every sandbox borrows from you: the GitHub accounts it acts as, and the MCP servers it can call.
          Configured once, stored on your server, injected into every run.
        </p>
        <div className="mt-10 flex flex-col gap-14">
          <Accounts embedded />
          <McpServers />
        </div>
      </div>
    </div>
  );
}
