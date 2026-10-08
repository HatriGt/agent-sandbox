// Autopilot (web: AutopilotPage.tsx): one home for work that runs without you. Automations say
// WHEN it starts; playbooks say HOW it gets done. `?tab=automations|playbooks` picks the tab.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/settings/Segmented";
import { CrossFade } from "@/components/motion";
import { AutomationsSection } from "@/components/automations/AutomationsSection";
import { PlaybooksSection } from "@/components/automations/PlaybooksSection";

type Tab = "automations" | "playbooks";
const HINT: Record<Tab, string> = { automations: "When it starts", playbooks: "How it gets done" };

export default function Autopilot() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "playbooks" ? "playbooks" : "automations");
  useEffect(() => {
    if (params.tab === "playbooks" || params.tab === "automations") setTab(params.tab);
  }, [params.tab]);

  // Counts on the tabs, as on web: live automations and saved playbooks.
  const [counts, setCounts] = useState<{ automations?: number; playbooks?: number }>({});
  useEffect(() => {
    api
      .automations()
      .then((r) => setCounts((c) => ({ ...c, automations: r.triggers.filter((t) => t.enabled).length })))
      .catch(() => {});
    api
      .workflows()
      .then((r) => setCounts((c) => ({ ...c, playbooks: r.workflows.length })))
      .catch(() => {});
  }, []);

  return (
    <SettingsScreen
      title="Autopilot"
      subtitle="Work that runs without you: when it starts, and how it gets done."
      right={tab === "automations" ? <Button small variant="ghost" title="New" onPress={() => router.push("/automation/new")} /> : undefined}
    >
      <View style={{ gap: 6 }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "automations", label: "Automations", badge: counts.automations || undefined },
            { value: "playbooks", label: "Playbooks", badge: counts.playbooks || undefined },
          ]}
        />
        <T variant="micro" tone="faint">
          {HINT[tab]}
        </T>
      </View>
      <CrossFade id={tab}>{tab === "automations" ? <AutomationsSection /> : <PlaybooksSection />}</CrossFade>
    </SettingsScreen>
  );
}
