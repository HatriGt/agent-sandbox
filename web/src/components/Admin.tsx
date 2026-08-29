import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Users } from "@/components/Users";

export function Admin({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3">
          <ArrowLeft className="size-4" />
          Account
        </Button>
        <header className="mb-7">
          <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Admin</h1>
          <p className="text-muted-foreground mt-0.5 text-meta">People on this controller. Admins see and can act on every machine.</p>
        </header>
        <Users />
      </div>
    </div>
  );
}
