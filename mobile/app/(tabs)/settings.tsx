import React from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/state/auth";
import { serverUrl } from "@/lib/config";
import { useTheme, type ThemePref } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { FadeInUp, PressScale, stagger } from "@/components/motion";
import { SelectionFill } from "@/components/settings/Segmented";

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
  const { pref, setPref } = useTheme();
  const isUser = me?.kind === "user";
  const admin = me?.role === "admin";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
        <T serif variant="h1" style={{ marginTop: 12, marginBottom: 8 }}>
          Settings
        </T>

        <Card style={{ marginVertical: 10 }}>
          <T variant="body" weight="semibold" numberOfLines={1}>
            {isUser && me.kind === "user" ? (me.name ?? me.login) : "Operator"}
          </T>
          <T variant="micro" mono tone="faint" numberOfLines={1}>
            {serverUrl().replace(/^https?:\/\//, "")}
          </T>
          {isUser && me.kind === "user" && me.plan === "trial" ? (
            <T variant="meta" tone={me.expired ? "destructive" : "attention"} style={{ marginTop: 4 }}>
              {me.expired
                ? "Trial expired — machines can't start until you upgrade."
                : `Trial · ${me.daysLeft ?? "?"} days left`}
            </T>
          ) : null}
        </Card>

        <Group title="Autopilot" />
        <FadeInUp delay={stagger(0)}>
          <RowLink title="Automations" icon="repeat" hint="Standing rules and what a chat asked for later — create, approve, pause" onPress={() => router.push("/automations")} />
          <RowLink title="Playbooks" icon="list" hint="Agent turns and command checks, in order" onPress={() => router.push("/settings/playbooks")} />
        </FadeInUp>

        <Group title="Library" />
        <FadeInUp delay={stagger(1)}>
          <RowLink title="Skills" icon="book-open" hint="The playbooks every sandbox gets — write, toggle, import" onPress={() => router.push("/settings/skills")} />
          <RowLink title="Memory" icon="layers" hint="What your agents learned on earlier runs — yours and per repo" onPress={() => router.push("/settings/memory")} />
          <RowLink title="Harnesses" icon="sliders" hint="Driver, model, skills and rules saved as one pick" onPress={() => router.push("/settings/harnesses")} />
        </FadeInUp>

        <Group title="Providers & Accounts" />
        <FadeInUp delay={stagger(2)}>
          <RowLink title="Model providers" icon="cpu" hint="Your keys · any endpoint · local models" onPress={() => router.push("/settings/providers")} />
          <RowLink title="GitHub accounts" icon="github" hint="Clone · read PRs · push" onPress={() => router.push("/settings/accounts")} />
          <RowLink title="MCP servers" icon="tool" hint="Extra tools every sandbox gets" onPress={() => router.push("/settings/mcp")} />
          <RowLink title="Repo setup" icon="package" hint="Learned once · install · test · verify" onPress={() => router.push("/settings/repo-setup")} />
          <RowLink title="Secrets" icon="key" hint="Tokens and keys runs get as env vars" onPress={() => router.push("/settings/secrets")} />
          <RowLink title="Starts from your inbox" icon="inbox" hint="Email · Slack" onPress={() => router.push("/settings/inbox")} />
        </FadeInUp>

        <Group title={isUser ? "Account" : "Operator"} />
        <FadeInUp delay={stagger(3)}>
          <RowLink title="Account" icon="user" hint="Plan, profile, password, coding agent, notifications, keys, devices, activity" onPress={() => router.push("/settings/account")} />
          <RowLink title="Connect an IDE" icon="code" hint="MCP setup for Claude Code, Cursor, VS Code, Windsurf" onPress={() => router.push("/settings/connect")} />
          {admin && me?.mode === "saas" && <RowLink title="Admin · users" icon="users" hint="People on this controller" onPress={() => router.push("/settings/admin")} />}
        </FadeInUp>

        <View style={{ marginTop: 20, gap: 8 }}>
          <T variant="micro" weight="medium" tone="faint" style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
            Theme
          </T>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {(["system", "light", "dark"] as ThemePref[]).map((p) => (
              <PressScale
                key={p}
                onPress={() => setPref(p)}
                haptic="selection"
                accessibilityRole="radio"
                accessibilityState={{ checked: pref === p }}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: pref === p ? palette.lineStrong : palette.border,
                  overflow: "hidden",
                }}
              >
                <SelectionFill on={pref === p} color={palette.accent} />
                <T variant="meta" weight={pref === p ? "semibold" : "regular"}>
                  {p}
                </T>
              </PressScale>
            ))}
          </View>
        </View>

        <View style={{ marginTop: 28 }}>
          <ArmButton title="Sign out" armedTitle="Tap again to sign out" onConfirm={signOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
