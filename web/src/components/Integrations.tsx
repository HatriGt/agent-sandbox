import * as React from "react";
import { ArrowLeft, Github, Info, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Accounts } from "@/components/Accounts";
import { McpServers } from "@/components/McpServers";

/**
 * Integrations — a settings page, designed like one: each section is a titled block with a one-line
 * purpose, the list of what is connected as compact rows, and a single primary action on the right
 * that opens a dialog. Explanations live behind (i) tooltips and inside the dialogs, next to the
 * field they explain — never as paragraphs above the content.
 */
export function Integrations({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-7 md:px-8 md:py-9">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
          <ArrowLeft className="size-4" />
          Machines
        </Button>
        <header className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Integrations</h1>
            <p className="text-muted-foreground mt-1 text-body">What every sandbox can use. Stored on your server.</p>
          </div>
        </header>

        <div className="flex flex-col gap-10">
          <Section
            icon={<Github className="size-4" />}
            title="GitHub accounts"
            line="Who the agent is on GitHub — used to clone, read PRs and push."
            help="A run on a repository uses the account that can access it. A task-only run uses the default account so `gh` works. Tokens never reach the browser."
          >
            <Accounts embedded />
          </Section>
          <Section
            icon={<Plug className="size-4" />}
            title="MCP servers"
            line="Tools the agent can call inside every sandbox — Jira, Slack, databases, your APIs."
            help="Enabled servers are handed to claude on the next run or turn of every machine, so the agent never has to stop and ask for access you could have configured. Paste the same JSON your IDE uses."
          >
            <McpServers />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, line, help, children }: { icon: React.ReactNode; title: string; line: string; help: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-start gap-3">
        <span className="bg-muted text-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground flex items-center gap-1.5 text-h3 font-semibold tracking-[-0.01em]">
            {title}
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={`About ${title}`} className="text-muted-foreground hover:text-foreground grid size-5 cursor-help place-items-center rounded">
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                {help}
              </TooltipContent>
            </Tooltip>
          </h2>
          <p className="text-muted-foreground text-meta">{line}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
