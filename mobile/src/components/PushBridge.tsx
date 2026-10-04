// Glue between expo-notifications and the router: permission + registration once signed in, and a
// tapped notification (warm or cold start) opens that box's Thread. A tapped choice action
// ("Answer 1/2/3", docs/plan-demo-parity.md bet 1) answers with its one-use nonce first. Renders nothing.
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/state/auth";
import { api } from "@/lib/api";
import { boxFromNotification, choiceFromResponse, configurePushPresentation, registerForPush, type ChoiceAction } from "@/lib/push";

configurePushPresentation();

/** "1 Mock the clock" out of the push body, for the confirm dialog (labels only — it is what the user saw). */
function choiceLabel(r: Notifications.NotificationResponse, choice: number): string {
  const body = r.notification.request.content.body ?? "";
  const part = body.split(" · ").find((p) => p.startsWith(`${choice + 1} `));
  return part ? part.slice(2) : `option ${choice + 1}`;
}

async function sendChoice(c: ChoiceAction): Promise<void> {
  try {
    const r = await api.answerQuestion(c.box, c.nonce, c.choice);
    if (r.already) return; // a replay of an answer that already went through: nothing to say
  } catch (e) {
    // 409/410: answered elsewhere, changed, or expired — the Thread we open shows the truth.
    Alert.alert("Answer not sent", e instanceof Error ? e.message : String(e));
  }
}

export function PushBridge() {
  const router = useRouter();
  const { ready, signedIn } = useAuth();
  const handled = useRef(new Set<string>());
  /** Choice taps that arrived while signed out: answered only after an explicit confirm. */
  const needsConfirm = useRef(new Set<string>());

  useEffect(() => {
    if (signedIn) void registerForPush();
  }, [signedIn]);

  useEffect(() => {
    if (!ready || signedIn) return;
    const mark = (r: Notifications.NotificationResponse | null) => {
      if (r && choiceFromResponse(r)) needsConfirm.current.add(r.notification.request.identifier);
    };
    void Notifications.getLastNotificationResponseAsync().then(mark).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(mark);
    return () => sub.remove();
  }, [ready, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const id = r.notification.request.identifier;
      if (handled.current.has(id)) return; // the cold-start response is also replayed to the listener
      handled.current.add(id);
      const box = boxFromNotification(r.notification);
      const choice = choiceFromResponse(r);
      if (box) router.push(`/box/${encodeURIComponent(box)}`);
      if (!choice) return;
      if (needsConfirm.current.has(id)) {
        needsConfirm.current.delete(id);
        Alert.alert("Send this answer?", `“${choiceLabel(r, choice.choice)}”`, [
          { text: "Not now", style: "cancel" },
          { text: "Send", onPress: () => void sendChoice(choice) },
        ]);
      } else {
        void sendChoice(choice);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [signedIn, router]);

  return null;
}
