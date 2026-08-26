/**
 * Credential broker — answers the agent's credential questions from the store, so the operator
 * never has to.
 *
 * The in-box agent is told to STOP and ask when it lacks a credential. For GitHub that is nearly
 * always a question the controller can answer itself: the login-keyed token store already holds an
 * account, and `resume` re-injects GH_TOKEN. So when a box pauses on a question that is really
 * "I have no GitHub auth", the broker resumes it once with the credential and a short note, instead
 * of surfacing a question the human cannot meaningfully answer differently.
 *
 * Guard rails: only fires when the question matches the GitHub-auth pattern AND a stored account
 * exists AND this exact (box, question) has not been auto-answered before — so a token that turns
 * out not to have access does not loop; the second time the same question surfaces, the human sees
 * it, with the broker's earlier attempt visible in the transcript.
 */

const GH_AUTH_RE =
  /\b(GH_TOKEN|GITHUB_TOKEN|gh auth login|gh auth|GitHub (auth|credential|token|PAT|personal access token)|authenticate (to|with) GitHub|hosts\.yml)\b/i;

export function isGithubAuthQuestion(question: string | undefined): boolean {
  return !!question && GH_AUTH_RE.test(question);
}

export function brokerAnswer(login: string): string {
  return (
    `GitHub credentials are available again: GH_TOKEN and GITHUB_TOKEN are set in your environment ` +
    `(account: ${login}). Continue the task from where you stopped; do not ask for GitHub auth again — ` +
    `if a specific repository is still inaccessible, say which one and stop.`
  );
}

export function makeCredentialBroker(opts: {
  /** The login of the account resume will inject, or undefined when the store is empty. */
  defaultLogin: () => Promise<string | undefined>;
  resume: (session: string, message: string) => Promise<unknown>;
  log?: (msg: string) => void;
}) {
  const answered = new Set<string>();
  const inFlight = new Set<string>();
  const log = opts.log ?? (() => {});

  /** Consider one waiting box. Returns true if the broker took the question. */
  return async function consider(session: string, question: string | undefined): Promise<boolean> {
    if (!isGithubAuthQuestion(question)) return false;
    const key = `${session}\n${question}`;
    if (answered.has(key) || inFlight.has(session)) return false;
    const login = await opts.defaultLogin();
    if (!login) return false;
    inFlight.add(session);
    answered.add(key);
    try {
      log(`[broker] auto-answering GitHub credential question on ${session} as ${login}`);
      await opts.resume(session, brokerAnswer(login));
      return true;
    } catch (e) {
      log(`[broker] auto-answer on ${session} failed: ${(e as Error).message}`);
      return false;
    } finally {
      inFlight.delete(session);
    }
  };
}
