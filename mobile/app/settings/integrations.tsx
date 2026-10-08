// Integrations (web: Integrations.tsx): everything every sandbox is given, one scrolling page in the
// web order. `?section=providers|accounts|mcp|secrets|repo-setup|inbox` scrolls to that section.
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@/state/auth";
import { SettingsScreen } from "@/components/SettingsScreen";
import { ProvidersSection } from "@/components/integrations/ProvidersSection";
import { AccountsSection } from "@/components/integrations/AccountsSection";
import { McpSection } from "@/components/integrations/McpSection";
import { SecretsSection } from "@/components/integrations/SecretsSection";
import { RepoSetupSection } from "@/components/integrations/RepoSetupSection";
import { InboxSection } from "@/components/integrations/InboxSection";

export type IntegrationsSection = "providers" | "accounts" | "mcp" | "secrets" | "repo-setup" | "inbox";

const ORDER: { id: IntegrationsSection; el: React.ReactNode }[] = [
  { id: "providers", el: <ProvidersSection /> },
  { id: "accounts", el: <AccountsSection /> },
  { id: "mcp", el: <McpSection /> },
  { id: "secrets", el: <SecretsSection /> },
  { id: "repo-setup", el: <RepoSetupSection /> },
  { id: "inbox", el: <InboxSection /> },
];

export default function Integrations() {
  const { me } = useAuth();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scroll = useRef<ScrollView>(null);
  // Section tops, measured by onLayout; the anchor scroll fires once the target has reported.
  const tops = useRef<Partial<Record<IntegrationsSection, number>>>({});
  const [target, setTarget] = useState<IntegrationsSection | null>(ORDER.some((s) => s.id === section) ? (section as IntegrationsSection) : null);
  const jump = (id: IntegrationsSection, y: number) => {
    tops.current[id] = y;
    if (target === id) {
      scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
      setTarget(null);
    }
  };
  useEffect(() => {
    if (target && tops.current[target] !== undefined) jump(target, tops.current[target]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return (
    <SettingsScreen
      title="Integrations"
      subtitle={me?.mode === "saas" ? "Yours alone — given only to your machines, encrypted at rest." : "Given to every sandbox on its next run or turn. Stored on your server."}
      scrollRef={scroll}
    >
      {ORDER.map((s) => (
        <View key={s.id} onLayout={(e) => jump(s.id, e.nativeEvent.layout.y)}>
          {s.el}
        </View>
      ))}
    </SettingsScreen>
  );
}
