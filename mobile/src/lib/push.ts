// Push notifications (server: src/push.ts). The controller sends through the Expo push service;
// this module owns the phone side: permission, token registration, Android channels, and turning a
// tapped notification or an asb:// link into a Thread route.
//
// No settings: once signed in the app asks the OS for permission (Android 13+ / iOS show their one
// dialog) and registers this phone. Every later start re-registers silently — tokens can rotate.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { api } from "./api";

const TOKEN_KEY = "asb.push.token";

/** Box names are machine-generated slugs; anything else in a link is refused, not routed. */
const BOX_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
export const isBoxName = (s: unknown): s is string => typeof s === "string" && BOX_RE.test(s);

/**
 * The Thread route for a link, or null. Accepts asb://box/<name>, the https dashboard form
 * (…/dashboard/#/box/<name> or …/dashboard/box/<name>), and bare "box/<name>" paths.
 */
export function boxFromLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = String(link).match(/(?:^asb:\/\/|^\/?|\/dashboard\/(?:#\/)?)box\/([^/?#]+)\/?(?:[?#].*)?$/);
  if (!m) return null;
  let name: string;
  try {
    name = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return isBoxName(name) ? name : null;
}

/** The box a notification points at (its data payload; never trusts the text). */
export function boxFromNotification(n: Notifications.Notification | null | undefined): string | null {
  const data = (n?.request.content.data ?? {}) as { box?: unknown; url?: unknown };
  if (isBoxName(data.box)) return data.box;
  return typeof data.url === "string" ? boxFromLink(data.url) : null;
}

/*
 * Answer from the notification (docs/plan-demo-parity.md bet 1). The server sends a question's
 * choice LABELS in the body ("1 Mock the clock · 2 Widen tolerance") with categoryId ask-choices-N
 * and a one-use nonce in data. iOS action titles are fixed per category, so the buttons are "1".."3"
 * matching the numbered labels. Every action requires an unlocked device and opens the app, which
 * answers with the signed-in session (or asks the user to sign in and confirm) — a lock screen can
 * never answer on its own.
 */
export const CHOICE_ACTION_PREFIX = "choice-";
const NONCE_RE = /^[A-Za-z0-9_-]{8,100}$/;

async function ensureChoiceCategories(): Promise<void> {
  for (const n of [2, 3]) {
    await Notifications.setNotificationCategoryAsync(
      `ask-choices-${n}`,
      Array.from({ length: n }, (_, i) => ({
        identifier: `${CHOICE_ACTION_PREFIX}${i}`,
        buttonTitle: `Answer ${i + 1}`,
        options: { opensAppToForeground: true, isAuthenticationRequired: true },
      })),
    );
  }
}

export interface ChoiceAction {
  box: string;
  nonce: string;
  choice: number;
}

/** The choice a notification action carries, or null for a plain tap / malformed payload. */
export function choiceFromResponse(r: Notifications.NotificationResponse | null | undefined): ChoiceAction | null {
  if (!r || !r.actionIdentifier.startsWith(CHOICE_ACTION_PREFIX)) return null;
  const choice = Number(r.actionIdentifier.slice(CHOICE_ACTION_PREFIX.length));
  const data = (r.notification.request.content.data ?? {}) as { box?: unknown; nonce?: unknown; choices?: unknown };
  if (!Number.isInteger(choice) || choice < 0 || choice > 2) return null;
  if (typeof data.choices === "number" && choice >= data.choices) return null;
  if (!isBoxName(data.box) || typeof data.nonce !== "string" || !NONCE_RE.test(data.nonce)) return null;
  return { box: data.box, nonce: data.nonce, choice };
}

let handlerSet = false;
/** Foreground presentation: show a banner but stay quiet — the user is already in the app. */
export function configurePushPresentation(): void {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  // Categories must exist before a push arrives; idempotent, and harmless where unsupported (web).
  void ensureChoiceCategories().catch(() => {});
}

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  // PRIVATE: on a secure lock screen Android shows "contents hidden" instead of the run title.
  await Notifications.setNotificationChannelAsync("needs-you", {
    name: "Needs you",
    description: "An agent stopped on a question.",
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync("runs", {
    name: "Runs",
    description: "A run finished, failed, or went quiet.",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export type PushStatus = "on" | "denied" | "unavailable";

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Ask (if the OS still lets us) and register this device with the controller. Never throws. */
export async function registerForPush(): Promise<PushStatus> {
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    if (!perm.granted) return "denied";
    await ensureChannels();
    const pid = projectId();
    // Throws in Expo Go on Android and on simulators without push support.
    const { data: token } = await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined);
    await api.pushRegister(token, Platform.OS);
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return "on";
  } catch {
    return "unavailable";
  }
}

/** Stop this phone receiving pushes (sign-out). Best-effort. */
export async function unregisterPush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  await api.pushUnregister(token).catch(() => {});
}

