import { Redirect } from "expo-router";
import { useAuth } from "@/state/auth";

export default function Index() {
  const { signedIn } = useAuth();
  return <Redirect href={signedIn ? "/(tabs)/home" : "/welcome"} />;
}
