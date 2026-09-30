// Push notifications (server: src/push.ts). The controller sends through the Expo push service;
// this module owns the phone side: permission, token registration, Android channels, and turning a
// tapped notification or an asb:// link into a Thread route.
//
// When we ask: never on a cold first launch. The OS prompt is one-shot on iOS, so it is spent at a
// moment the user can see the value — right after they hand off their first task ("we'll tell you
// when it needs you"), or when they flip the toggle in Settings → Notifications. If permission is
// already granted, app start re-registers silently (tokens can rotate).
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { api } from "./api";

const TOKEN_KEY = "asb.push.token";
const ASKED_KEY = "asb.push.asked";
/** Set when the user turned push off in Settings: silent re-registration must respect it. */
const OPTOUT_KEY = "asb.push.optout";

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
    description: "An agent stopped on a question or hit its budget.",
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

export type PushStatus = "on" | "off" | "denied" | "unavailable";

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Register this device with the controller. `prompt: false` never shows the OS dialog (used on
 * app start); `prompt: true` asks if the OS still lets us. Never throws — push is an enhancement.
 */
export async function registerForPush(opts: { prompt: boolean }): Promise<PushStatus> {
  try {
    if (!opts.prompt && (await AsyncStorage.getItem(OPTOUT_KEY))) return "off";
    if (opts.prompt) await AsyncStorage.removeItem(OPTOUT_KEY);
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && opts.prompt && perm.canAskAgain) {
      await AsyncStorage.setItem(ASKED_KEY, "1");
      perm = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    }
    if (!perm.granted) return perm.canAskAgain ? "off" : "denied";
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

/** Ask once, at a moment of value (first handoff). Later calls are silent re-registrations. */
export async function offerPushAfterHandoff(): Promise<void> {
  const asked = await AsyncStorage.getItem(ASKED_KEY).catch(() => "1");
  if (asked) return void (await registerForPush({ prompt: false }));
  const perm = await Notifications.getPermissionsAsync().catch(() => null);
  if (!perm || perm.granted || !perm.canAskAgain) return void (await registerForPush({ prompt: false }));
  // In-app pre-prompt: the iOS system dialog is one-shot, so it is only shown after a yes here.
  await AsyncStorage.setItem(ASKED_KEY, "1").catch(() => {});
  Alert.alert(
    "Get told when it needs you?",
    "A notification when a run asks a question, finishes, or fails. Only the run's title and answer choices are shown — never its question or code.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Turn on", onPress: () => void registerForPush({ prompt: true }) },
    ],
  );
}

/** Stop this phone receiving pushes (sign-out, or the Settings toggle). Best-effort. */
export async function unregisterPush(opts: { optOut?: boolean } = {}): Promise<void> {
  if (opts.optOut) await AsyncStorage.setItem(OPTOUT_KEY, "1").catch(() => {});
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  await api.pushUnregister(token).catch(() => {});
}

export async function pushEnabledHere(): Promise<boolean> {
  return Boolean(await AsyncStorage.getItem(TOKEN_KEY).catch(() => null));
}
