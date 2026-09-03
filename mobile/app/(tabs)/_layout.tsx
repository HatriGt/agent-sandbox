import React from "react";
import { Redirect, Tabs, useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { fonts } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";

function TabGlyph({ glyph, focused }: { glyph: string; focused: boolean }) {
  const { palette } = useTheme();
  return (
    <T variant="h3" style={{ color: focused ? palette.foreground : palette.faint }}>
      {glyph}
    </T>
  );
}

/** Center "New" button: the one prominent action, ink on paper. */
function NewButton() {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={() => router.push("/new")}
      style={({ pressed }) => ({
        top: -14,
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: palette.primary,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "center",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <T variant="h2" style={{ color: palette.primaryForeground, lineHeight: 26 }}>
        ＋
      </T>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { signedIn, ready } = useAuth();
  const { palette } = useTheme();
  if (ready && !signedIn) return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: palette.card,
          borderTopColor: palette.border,
          borderTopWidth: 1,
          elevation: 0,
        },
        tabBarActiveTintColor: palette.foreground,
        tabBarInactiveTintColor: palette.faint,
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11 },
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", tabBarIcon: ({ focused }) => <TabGlyph glyph="◉" focused={focused} /> }}
      />
      <Tabs.Screen
        name="fleet"
        options={{ title: "Fleet", tabBarIcon: ({ focused }) => <TabGlyph glyph="▤" focused={focused} /> }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: "",
          tabBarButton: () => (
            <View style={{ flex: 1 }}>
              <NewButton />
            </View>
          ),
        }}
        listeners={{ tabPress: (e) => e.preventDefault() }}
      />
      <Tabs.Screen
        name="activity"
        options={{ title: "Activity", tabBarIcon: ({ focused }) => <TabGlyph glyph="◷" focused={focused} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ focused }) => <TabGlyph glyph="⚙" focused={focused} /> }}
      />
    </Tabs>
  );
}
