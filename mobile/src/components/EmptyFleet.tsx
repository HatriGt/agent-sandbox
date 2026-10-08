import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { T } from "./ui/AppText";
import { Button } from "./ui/Button";
import { BrandMark } from "./ui/BrandMark";

/** No machines yet: the mark, one line of copy, and the way in. Shared by Home and Fleet. */
export function EmptyFleet({ copy }: { copy: string }) {
  const router = useRouter();
  return (
    <View style={{ marginTop: 32, gap: 14, alignItems: "center" }}>
      <BrandMark size={72} animate />
      <T variant="body" tone="muted" style={{ textAlign: "center" }}>
        {copy}
      </T>
      <Button title="Delegate a task" variant="secondary" onPress={() => router.push("/new")} />
    </View>
  );
}
