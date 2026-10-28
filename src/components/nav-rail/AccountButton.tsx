import { useState } from "react";
import { useCoralAuth } from "@coral-ai/react";
import { Settings } from "@coral-ai/bundleicons/Settings";
import { Tooltip } from "@fluentui/react-components";
import { AvatarButton } from "../avatar-button";
import { Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../menu";
import { SettingsOverlay } from "../settings";

/**
 * The user, as an avatar at the rail's foot: Coral's auth identity (name,
 * image, colour), with Panel.UserCard's menu: Settings, which opens the
 * settings overlay (components/settings), then Logout when signed in with a
 * sign-out, or Sign in when signed out. Without an auth provider it shows the
 * neutral person avatar as "You".
 */
export function AccountButton() {
  const auth = useCoralAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      <Menu positioning="after-bottom">
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
            <MenuItem icon={<Settings />} onClick={() => setSettingsOpen(true)}>
              Settings
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
      <SettingsOverlay open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
