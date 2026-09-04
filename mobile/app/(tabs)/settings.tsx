import React from "react";
import { Pressable, ScrollView, View } from "react-native";
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

function RowLink({ title, hint, icon, onPress }: { title: string; hint?: string; icon: IconName; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
        opacity: pressed ? 0.7 : 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
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
    </Pressable>
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

        {isUser && <RowLink title="Account" icon="user" hint="Name, email, password" onPress={() => router.push("/settings/account")} />}
        <RowLink title="GitHub accounts" icon="github" hint="Tokens the agent clones and pushes with" onPress={() => router.push("/settings/accounts")} />
        <RowLink title="MCP servers" icon="tool" hint="Extra tools every sandbox gets" onPress={() => router.push("/settings/mcp")} />
        <RowLink title="Skills" icon="book-open" hint="Reusable playbooks synced into each box" onPress={() => router.push("/settings/skills")} />
        <RowLink title="Notifications" icon="bell" hint="Webhook pings when a machine needs you" onPress={() => router.push("/settings/notifications")} />
        {isUser && <RowLink title="API keys" icon="key" hint="Bearer keys for scripts and devices" onPress={() => router.push("/settings/api-keys")} />}
        {isUser && <RowLink title="Signed-in devices" icon="smartphone" hint="Active sessions, revoke any" onPress={() => router.push("/settings/devices")} />}
        <RowLink title="Connect an IDE" icon="code" hint="MCP snippets for Cursor, Claude Code, Zed" onPress={() => router.push("/settings/connect")} />
        {admin && <RowLink title="Admin · Users" icon="users" hint="Manage accounts and plans" onPress={() => router.push("/settings/admin")} />}

        <View style={{ marginTop: 20, gap: 8 }}>
          <T variant="meta" weight="medium" tone="muted">
            Appearance
          </T>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {(["system", "light", "dark"] as ThemePref[]).map((p) => (
              <Pressable
                key={p}
                onPress={() => setPref(p)}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: radius.pill,
                  backgroundColor: pref === p ? palette.accent : "transparent",
                  borderWidth: 1,
                  borderColor: pref === p ? palette.lineStrong : palette.border,
                }}
              >
                <T variant="meta" weight={pref === p ? "semibold" : "regular"}>
                  {p}
                </T>
              </Pressable>
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
