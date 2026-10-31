// The Windows app's GitHub sign-in, for its updates: the repo its releases
// come from is private, so whoever the app is shared with signs in once, with
// a GitHub account that can see the repo, and Help → Check for updates uses
// that. The Windows app (desktop/) runs GitHub's device sign-in and keeps the
// token in Windows Credential Manager; the page starts and cancels it and is
// told who is signed in, never the token. In a browser, and in the Electron
// app, there is no bridge, and none of this.

/** A GitHub account, as the page may see it. */
export type GitHubAccount = { login: string };

/** GitHub's device sign-in, once started: the code to enter at its page. */
export type GitHubDeviceCode = { userCode: string; verificationUri: string; expiresInSeconds: number };

/** The Windows app's bridge (desktop/Bridge/HostBridge.js). */
type MicaGitHub = {
  /** Who is signed in, or null. */
  account(): Promise<GitHubAccount | null>;
  /** Starts the device sign-in, in place of one still waiting. */
  startSignIn(): Promise<GitHubDeviceCode>;
  /** Resolves once it finishes: signed in, or why not (expired, denied, cancelled). */
  finishSignIn(): Promise<GitHubAccount | { error: string }>;
  cancelSignIn(): void;
  /** Opens GitHub's device page in the browser. */
  openVerification(): void;
  signOut(): Promise<void>;
};

declare global {
  interface Window {
    micaGitHub?: MicaGitHub;
  }
}

/** The bridge, in the Windows app only. */
export function gitHubBridge(): MicaGitHub | undefined {
  return typeof window === "undefined" ? undefined : window.micaGitHub;
}

// Who is signed in, as last heard, for the account menu; undefined until asked.
let account: GitHubAccount | null | undefined;
const listeners = new Set<() => void>();

function set(next: GitHubAccount | null): void {
  if (account !== undefined && (next?.login ?? null) === (account?.login ?? null)) return;
  account = next;
  for (const listener of listeners) listener();
}

export function subscribeGitHubAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const gitHubAccount = () => account;

/** Asks the app who is signed in, and tells whoever listens. */
export async function refreshGitHubAccount(): Promise<GitHubAccount | null> {
  const next = (await gitHubBridge()?.account().catch(() => null)) ?? null;
  set(next);
  return next;
}

/** Signed in (or out) here: whoever listens hears it. */
export const noteGitHubAccount = (next: GitHubAccount | null) => set(next);
