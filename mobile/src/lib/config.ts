import * as SecureStore from "expo-secure-store";

// Server URL + bearer credential live in the platform keychain/keystore.
const URL_KEY = "asb-server-url";
const TOKEN_KEY = "asb-bearer";

export const DEFAULT_SERVER = "https://agent-sandbox.ajeethkumar.dev";

let cachedUrl: string | null = null;
let cachedToken: string | null = null;

export async function loadConfig(): Promise<{ url: string | null; token: string | null }> {
  cachedUrl = await SecureStore.getItemAsync(URL_KEY);
  cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
  return { url: cachedUrl, token: cachedToken };
}

export function serverUrl(): string {
  return cachedUrl ?? DEFAULT_SERVER;
}

export function bearer(): string | null {
  return cachedToken;
}

export async function setServerUrl(url: string) {
  cachedUrl = url.replace(/\/+$/, "");
  await SecureStore.setItemAsync(URL_KEY, cachedUrl);
}

export async function setBearer(token: string | null) {
  cachedToken = token;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}
