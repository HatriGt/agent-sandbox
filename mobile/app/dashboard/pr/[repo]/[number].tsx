/**
 * Alias for web dashboard links: https://<host>/dashboard/pr/<repo>/<number>
 * (Android App Links) lands here and forwards to the native PR screen.
 */
import { Redirect, useLocalSearchParams } from "expo-router";

export default function DashboardPrAlias() {
  const { repo, number } = useLocalSearchParams<{ repo: string; number: string }>();
  return <Redirect href={`/pr/${encodeURIComponent(String(repo ?? ""))}/${encodeURIComponent(String(number ?? ""))}`} />;
}
