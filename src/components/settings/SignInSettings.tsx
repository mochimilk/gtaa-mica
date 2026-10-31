// Settings' Sign in page: GitHub, for the Windows app's updates (see
// ./gitHubAccount). Signed out, a button starts GitHub's device sign-in; the
// page then shows the code to enter, opens GitHub's page for it, and waits
// until it is approved, expires or is cancelled. Signed in, it shows who, and
// Sign out. Outside the Windows app it says so, with nothing to press.
import { useEffect, useState } from "react";
import { Copy } from "@coral-ai/bundleicons/Copy";
import { Open } from "@coral-ai/bundleicons/Open";
import { Button, Caption1, Label, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import {
  gitHubBridge,
  noteGitHubAccount,
  refreshGitHubAccount,
  type GitHubAccount,
  type GitHubDeviceCode,
} from "./gitHubAccount";

const useStyles = makeStyles({
  // As the other pages': the page's name, then its settings.
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  // The code to type at GitHub, big enough to read across the room.
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeHero700,
    lineHeight: tokens.lineHeightHero700,
    letterSpacing: "0.12em",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
  },
});

type State =
  | { kind: "loading" }
  | { kind: "signed-out"; error?: string }
  | { kind: "waiting"; code: GitHubDeviceCode }
  | { kind: "signed-in"; account: GitHubAccount };

export function SignInSettings() {
  const styles = useStyles();
  const bridge = gitHubBridge();
  const [state, setState] = useState<State>(bridge ? { kind: "loading" } : { kind: "signed-out" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!bridge) return undefined;
    let current = true;
    void refreshGitHubAccount().then((account) => {
      if (current) setState(account ? { kind: "signed-in", account } : { kind: "signed-out" });
    });
    // Leaving the page stops a sign-in still waiting.
    return () => {
      current = false;
      bridge.cancelSignIn();
    };
  }, [bridge]);

  const signIn = async () => {
    if (!bridge) return;
    let code: GitHubDeviceCode;
    try {
      code = await bridge.startSignIn();
    } catch {
      setState({ kind: "signed-out", error: "GitHub couldn't be reached. Check your connection and try again." });
      return;
    }
    setCopied(false);
    setState({ kind: "waiting", code });
    bridge.openVerification();
    const result = await bridge.finishSignIn().catch(() => ({ error: "Sign-in stopped." }));
    if ("login" in result) {
      noteGitHubAccount(result);
      setState({ kind: "signed-in", account: result });
    } else {
      setState((now) => (now.kind === "waiting" ? { kind: "signed-out", error: result.error } : now));
    }
  };
  const cancel = () => {
    bridge?.cancelSignIn();
    setState({ kind: "signed-out" });
  };
  const signOut = async () => {
    await bridge?.signOut().catch(() => {});
    noteGitHubAccount(null);
    setState({ kind: "signed-out" });
  };
  const copy = (text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );

  return (
    <div className={styles.root}>
      <Label size="large" weight="semibold">
        Sign in
      </Label>

      {!bridge && (
        <Text className={styles.muted}>
          Only in the Windows app. Signing in there lets it check GitHub for updates.
        </Text>
      )}

      {bridge && state.kind === "loading" && <Spinner size="tiny" label="Checking…" labelPosition="after" />}

      {bridge && state.kind === "signed-out" && (
        <div className={styles.section}>
          <Text>
            Sign in with GitHub so the app can check for updates. Your account needs access to the app's repository;
            ask whoever shared the app with you if it doesn't have it.
          </Text>
          <div className={styles.actions}>
            <Button appearance="primary" onClick={() => void signIn()}>
              Sign in with GitHub
            </Button>
          </div>
          {state.error && <Caption1 className={styles.error}>{state.error}</Caption1>}
          <Caption1 className={styles.muted}>
            The app keeps your sign-in in Windows Credential Manager on this computer, and uses it only to read the
            app's releases. It never shows it, here or anywhere else.
          </Caption1>
        </div>
      )}

      {bridge && state.kind === "waiting" && (
        <div className={styles.section}>
          <Text>Enter this code on GitHub's page, then approve the app there.</Text>
          <Text className={styles.code} aria-label={`Code ${state.code.userCode.split("").join(" ")}`}>
            {state.code.userCode}
          </Text>
          <div className={styles.actions}>
            <Button icon={<Copy />} onClick={() => copy(state.code.userCode)}>
              {copied ? "Copied" : "Copy code"}
            </Button>
            <Button icon={<Open />} onClick={() => bridge.openVerification()}>
              Open GitHub
            </Button>
            <Button appearance="subtle" onClick={cancel}>
              Cancel
            </Button>
          </div>
          <Spinner size="tiny" label="Waiting for you to approve it on GitHub…" labelPosition="after" />
        </div>
      )}

      {bridge && state.kind === "signed-in" && (
        <div className={styles.section}>
          <Text>
            Signed in to GitHub as <strong>@{state.account.login}</strong>. Help → Check for updates uses it.
          </Text>
          <div className={styles.actions}>
            <Button onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>
      )}
    </div>
  );
}
