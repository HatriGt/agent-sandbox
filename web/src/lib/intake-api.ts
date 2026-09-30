import { apiRaw } from "@/lib/api";

/** "Starts from your inbox" — email / Slack intake settings and the composer's link unfurl. */

export type EmailProvider = "postmark" | "sendgrid" | "mailgun" | "cloudflare";

export interface IntakeChannel {
  id: string;
  allowEmails: string[];
  slackUsers: string[];
  defaultRepo?: string;
  hasMailgunKey: boolean;
  hasSlackSecret: boolean;
  hasSlackBotToken: boolean;
  hasSentryToken: boolean;
}

export interface IntakePending {
  id: string;
  source: "email" | "slack";
  task: string;
  choices: string[];
  meta: { from?: string };
  createdAt: number;
  attachmentCount: number;
}

export interface IntakeDelivery {
  id: number;
  at: number;
  outcome: "fired" | "skipped" | "rejected" | "failed";
  reason?: string;
  detail?: string;
  box?: string;
}

export interface IntakeView {
  channel: IntakeChannel;
  accountEmail: string | null;
  email: { urls: Record<EmailProvider, string>; cloudflareWorker: string };
  slack: { url: string; manifest: string };
  pending: IntakePending[];
  deliveries: IntakeDelivery[];
}

export interface IntakeUpdate {
  allowEmails?: string[];
  slackUsers?: string[];
  defaultRepo?: string;
  mailgunKey?: string;
  slackSigningSecret?: string;
  slackBotToken?: string;
  sentryToken?: string;
}

export interface Unfurled {
  task: string;
  title: string;
  source: "github" | "sentry";
  repo?: string;
}

export const intakeApi = {
  get: async (): Promise<IntakeView> => apiRaw.parse<IntakeView>(await fetch(apiRaw.url("/intake.json"), { headers: apiRaw.authHeaders })),
  update: (u: IntakeUpdate) => apiRaw.post<IntakeView>("/intake.json", u),
  rotate: () => apiRaw.post<IntakeView>("/intake/rotate.json", {}),
  answer: (id: string, repo: string) => apiRaw.post<{ ok: true; box: string; url: string }>(`/intake/pending/${encodeURIComponent(id)}/answer.json`, { repo }),
  dismiss: (id: string) => apiRaw.post<{ ok: true }>(`/intake/pending/${encodeURIComponent(id)}/dismiss.json`, {}),
  unfurl: (url: string) => apiRaw.post<Unfurled>("/intake/unfurl.json", { url }),
};

/** Mirrors src/intake.ts parseIssueUrl — only whole-paste links worth a round trip. */
export function isUnfurlable(text: string): boolean {
  const s = text.trim();
  if (!/^https:\/\/\S+$/.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.hostname === "github.com") return /^\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+/.test(u.pathname);
    if (u.hostname === "sentry.io") return /^\/organizations\/[\w-]+\/issues\/\d+/.test(u.pathname);
    if (/^[\w-]+\.sentry\.io$/.test(u.hostname)) return /^\/issues\/\d+/.test(u.pathname);
  } catch {
    /* not a URL */
  }
  return false;
}
