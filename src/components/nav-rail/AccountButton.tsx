import { useCoralAuth } from "@coral-ai/react";
import { Tooltip } from "@fluentui/react-components";
import { AvatarButton } from "../avatar-button";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../menu";

/**
 * The user, as an avatar at the rail's foot: Coral's auth identity (name,
 * image, colour), with Panel.UserCard's menu (Logout when signed in with a
 * sign-out, Sign in when signed out). Without an auth provider it shows the
 * neutral person avatar as "You", with no menu.
 */
export function AccountButton() {
  const auth = useCoralAuth();
  const user = auth?.status === "signed-in" ? auth.user : undefined;
  const label =
    auth?.status === "signed-out" ? "Sign in" : auth?.status === "loading" ? "Signing in" : (user?.name ?? "You");
  const action =
    auth?.status === "signed-in" && auth.signOut
      ? { label: "Logout", run: auth.signOut }
      : auth?.status === "signed-out"
        ? { label: "Sign in", run: auth.signIn }
        : null;

  const button = (
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
  );
  if (!action) return button;
  return (
    <Menu positioning="after-bottom">
      <MenuTrigger disableButtonEnhancement>{button}</MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem onClick={() => void action.run()}>{action.label}</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
