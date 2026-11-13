// The app's settings, as Coral's playground has them: Coral's Overlay over
// the whole window, opened from the account menu (nav-rail/AccountButton),
// its pages down the left. Appearance holds the board's look, which was in
// its View menu; API takes the user's own OpenAI key for Skye, in the desktop
// app, for as long as the window is open; Sign in signs the Windows app in to
// GitHub, for its updates (the account menu's Sign in opens it).
import { Overlay, type OverlayMenuItem } from "@coral-ai/react";
import { Color } from "@coral-ai/bundleicons/Color";
import { Key } from "@coral-ai/bundleicons/Key";
import { PersonAccounts } from "@coral-ai/bundleicons/PersonAccounts";
import { Portal, PortalMountNodeProvider } from "@fluentui/react-components";
import { settingsNode, settingsPortalNode } from "../window-layer";
import { ApiSettings } from "./ApiSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { SignInSettings } from "./SignInSettings";
import { SourceSettings } from "./SourceSettings";

/** The pages, by the value each opens on. */
export type SettingsPage = "appearance" | "source" | "api" | "sign-in";

const PAGES: (OverlayMenuItem & { value: SettingsPage })[] = [
  { value: "appearance", label: "Appearance", icon: <Color />, content: <AppearanceSettings /> },
  { value: "source", label: "Schedule source", content: <SourceSettings /> },
  { value: "api", label: "API", icon: <Key />, content: <ApiSettings /> },
  { value: "sign-in", label: "Sign in", icon: <PersonAccounts />, content: <SignInSettings /> },
];

export type SettingsOverlayProps = {
  open: boolean;
  onClose: () => void;
  /** The page it opens on; Appearance unless given. */
  page?: SettingsPage;
};

/**
 * Settings over the whole window, on Appearance (or `page`) each time it opens; Escape,
 * the close button or a click outside the card closes it. Portalled under
 * Fluent's theme to its own layer at the top of the page (window-layer), over
 * Skye's cursors, her orbs and tethers, and the app's floating windows, so
 * no ancestor's filter or transform can hold Coral's fixed backdrop; what
 * opens from it (a tooltip, a menu) mounts over it in turn.
 */
export function SettingsOverlay({ open, onClose, page = "appearance" }: SettingsOverlayProps) {
  if (!open) return null;
  return (
    <PortalMountNodeProvider value={settingsNode()}>
      <Portal>
        <PortalMountNodeProvider value={settingsPortalNode()}>
          <Overlay open onClose={onClose}>
            {/* mica-settings: solid with effects reduced (components/effects/effects.css). */}
            <Overlay.Menu className="mica-settings" label="Settings" onClose={onClose} items={PAGES} defaultValue={page} />
          </Overlay>
        </PortalMountNodeProvider>
      </Portal>
    </PortalMountNodeProvider>
  );
}
