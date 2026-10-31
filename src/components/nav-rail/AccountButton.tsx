import { useEffect, useState, useSyncExternalStore } from "react";
import { useCoralAuth } from "@coral-ai/react";
import { PersonAccounts } from "@coral-ai/bundleicons/PersonAccounts";
import { Settings } from "@coral-ai/bundleicons/Settings";
import { Tooltip } from "@fluentui/react-components";
import { AvatarButton } from "../avatar-button";
import { Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../menu";
import {
  gitHubAccount,
  refreshGitHubAccount,
  SettingsOverlay,
  subscribeGitHubAccount,
  type SettingsPage,
} from "../settings";

/**
 * The user, as an avatar at the rail's foot: Coral's auth identity (name,
 * image, colour), with Panel.UserCard's menu: Settings, which opens the
 * settings overlay (components/settings); Sign in, which opens it on its
 * Sign in page, for the Windows app's GitHub sign-in (its updates), naming
 * the account once signed in; then Logout when signed in with a sign-out, or
 * Sign in when signed out. Without an auth provider it shows the neutral
 * person avatar as "You".
 */
export function AccountButton() {
  const auth = useCoralAuth();
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const gitHub = useSyncExternalStore(subscribeGitHubAccount, gitHubAccount);
  // The Windows app asks for a Settings page (Help → Check for updates, signed out).
  useEffect(() => {
    const open = (event: Event) => {
      const page = (event as CustomEvent<unknown>).detail;
      if (page === "sign-in" || page === "api" || page === "appearance") setSettingsPage(page);
    };
    window.addEventListener("mica:open-settings", open);
    return () => window.removeEventListener("mica:open-settings", open);
  }, []);
  const user = auth?.status === "signed-in" ? auth.user : undefined;
  const label =
    auth?.status === "signed-out" ? "Sign in" : auth?.status === "loading" ? "Signing in" : (user?.name ?? "You");
  const action =
    auth?.status === "signed-in" && auth.signOut
      ? { label: "Logout", run: auth.signOut }
      : auth?.status === "signed-out"
        ? { label: "Sign in", run: auth.signIn }
        : null;

  return (
    <>
      <Menu positioning="after-bottom" onOpenChange={(_, data) => data.open && void refreshGitHubAccount()}>
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={label} relationship="label" positioning="after">
            <AvatarButton
              disabledFocusable={auth?.status === "loading"}
              avatar={{
                name: user?.name,
                image: user?.image ? { src: user.image } : undefined,
                idForColor: user?.idForColor,
                color: user?.name ? "colorful" : undefined,
              }}
            />
          </Tooltip>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<Settings />} onClick={() => setSettingsPage("appearance")}>
              Settings
            </MenuItem>
            <MenuItem icon={<PersonAccounts />} onClick={() => setSettingsPage("sign-in")}>
              {gitHub ? `@${gitHub.login}` : "Sign in"}
            </MenuItem>
            {action && (
              <>
                <MenuDivider />
                <MenuItem onClick={() => void action.run()}>{action.label}</MenuItem>
              </>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
      <SettingsOverlay
        open={settingsPage !== null}
        page={settingsPage ?? undefined}
        onClose={() => setSettingsPage(null)}
      />
    </>
  );
}
