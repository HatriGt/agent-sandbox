// Glue between expo-notifications and the router: silent re-registration once signed in, and a
// tapped notification (warm or cold start) opens that box's Thread. Renders nothing.
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/state/auth";
import { boxFromNotification, configurePushPresentation, registerForPush } from "@/lib/push";

configurePushPresentation();

export function PushBridge() {
  const router = useRouter();
  const { signedIn } = useAuth();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (signedIn) void registerForPush({ prompt: false });
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const id = r.notification.request.identifier;
      if (handled.current.has(id)) return; // the cold-start response is also replayed to the listener
      handled.current.add(id);
      const box = boxFromNotification(r.notification);
      if (box) router.push(`/box/${encodeURIComponent(box)}`);
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [signedIn, router]);

  return null;
}
