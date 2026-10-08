import React from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/state/auth";
import { serverUrl } from "@/lib/config";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Icon, type IconName } from "@/components/ui/Icon";
import { FadeInUp, PressScale, stagger } from "@/components/motion";

function RowLink({ title, hint, icon, onPress }: { title: string; hint?: string; icon: IconName; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      style={{
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.md,
          backgroundColor: palette.secondary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={15} color={palette.foreground} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="body" weight="medium" numberOfLines={1}>
          {title}
        </T>
        {hint ? (
          <T variant="micro" tone="faint" numberOfLines={2}>
            {hint}
          </T>
        ) : null}
      </View>
      <View style={{ flexShrink: 0 }}>
        <Icon name="chevron-right" size={16} color={palette.faint} />
      </View>
    </PressScale>
  );
}

function Group({ title }: { title: string }) {
  return (
    <T variant="micro" weight="medium" tone="faint" style={{ marginTop: 20, marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.6 }}>
      {title}
    </T>
  );
}

export default function Settings() {
  const router = useRouter();
  const { palette } = useTheme();
  const { me, signOut } = useAuth();
  const isUser = me?.kind === "user";
  const admin = me?.role === "admin";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
        <T serif variant="h1" style={{ marginTop: 12, marginBottom: 8 }}>
          Settings
        </T>
        <Group title="Workspace" />
        <FadeInUp delay={stagger(0)}>
          <RowLink title="Autopilot" icon="repeat" hint="Work that runs without you: when it starts, and how it gets done" onPress={() => router.push("/settings/autopilot")} />
          <RowLink title="History" icon="clock" hint="Archived runs" onPress={() => router.navigate({ pathname: "/(tabs)/activity", params: { tab: "history" } })} />
          <RowLink title="Activity" icon="activity" hint="Every state-changing call, kept 90 days" onPress={() => router.navigate("/(tabs)/activity")} />
        </FadeInUp>

        <Group title="Resources" />
        <FadeInUp delay={stagger(1)}>
          <RowLink title="Skills" icon="zap" hint="The playbooks every sandbox gets — write, toggle, import" onPress={() => router.push("/settings/skills")} />
          <RowLink title="Memory" icon="layers" hint="What your agents learned on earlier runs — yours and per repo" onPress={() => router.push("/settings/memory")} />
          <RowLink title="Harnesses" icon="sliders" hint="Driver, model, skills and rules saved as one pick" onPress={() => router.push("/settings/harnesses")} />
          <RowLink title="Integrations" icon="link" hint="Model providers · GitHub accounts · MCP servers · Secrets · Repo setup · Inbox" onPress={() => router.push("/settings/integrations")} />
        </FadeInUp>

        <Group title={isUser ? "Account" : "Operator"} />
        <FadeInUp delay={stagger(2)}>
          <PressScale
            onPress={() => router.push("/settings/account")}
            accessibilityRole="button"
            style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: palette.border, flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: `${palette.live}1a`, alignItems: "center", justifyContent: "center" }}>
              {isUser && me.kind === "user" ? (
                <T variant="micro" weight="semibold" style={{ color: palette.live, textTransform: "uppercase" }}>
                  {(me.name || me.login).slice(0, 1)}
                </T>
              ) : (
                <Icon name="user" size={15} color={palette.foreground} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="body" weight="medium" numberOfLines={1}>
                {isUser && me.kind === "user" ? (me.name ?? me.login) : "Operator"}
              </T>
              <T variant="micro" mono tone="faint" numberOfLines={1}>
                {serverUrl().replace(/^https?:\/\//, "")}
              </T>
              {isUser && me.kind === "user" && me.plan === "trial" ? (
                <T variant="micro" tone={me.expired ? "destructive" : "attention"}>
                  {me.expired ? "Trial expired — machines can't start until you upgrade." : `Trial · ${me.daysLeft ?? "?"} days left`}
                </T>
              ) : null}
            </View>
            <View style={{ flexShrink: 0 }}>
              <Icon name="chevron-right" size={16} color={palette.faint} />
            </View>
          </PressScale>
          <RowLink title="Connect an IDE" icon="code" hint="MCP setup for Claude Code, Cursor, VS Code, Windsurf" onPress={() => router.push("/settings/connect")} />
          {admin && me?.mode === "saas" && <RowLink title="Admin" icon="shield" hint="People on this controller" onPress={() => router.push("/settings/admin")} />}
        </FadeInUp>

        <View style={{ marginTop: 28 }}>
          <ArmButton title="Sign out" armedTitle="Tap again to sign out" onConfirm={signOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
