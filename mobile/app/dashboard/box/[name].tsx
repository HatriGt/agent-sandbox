/**
 * Alias for web dashboard links: https://<host>/dashboard/box/<name> (Android App
 * Links) lands here and forwards to the real thread screen at /box/<name>.
 */
import { Redirect, useLocalSearchParams } from "expo-router";

export default function DashboardBoxAlias() {
  const { name } = useLocalSearchParams<{ name: string }>();
  return <Redirect href={`/box/${encodeURIComponent(String(name ?? ""))}`} />;
}
