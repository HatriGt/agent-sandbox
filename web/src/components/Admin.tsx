import { SettingsPage } from "@/components/ui/settings";
import { Users } from "@/components/Users";

export function Admin({ onBack }: { onBack: () => void }) {
  return (
    <SettingsPage title="Admin" purpose="People on this controller. Admins see and can act on every machine." back={{ label: "Account", onClick: onBack }}>
      <Users />
    </SettingsPage>
  );
}
