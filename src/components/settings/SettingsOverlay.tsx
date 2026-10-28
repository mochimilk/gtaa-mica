// The app's settings, as Coral's playground has them: Coral's Overlay over
// the whole window, opened from the account menu (nav-rail/AccountButton),
// its pages down the left. Appearance holds the board's look, which was in
// its View menu; API takes the user's own OpenAI key (visual only for now).
import { Overlay, type OverlayMenuItem } from "@coral-ai/react";
import { Color } from "@coral-ai/bundleicons/Color";
import { Key } from "@coral-ai/bundleicons/Key";
import { Portal } from "@fluentui/react-components";
import { ApiSettings } from "./ApiSettings";
import { AppearanceSettings } from "./AppearanceSettings";

const PAGES: OverlayMenuItem[] = [
  { value: "appearance", label: "Appearance", icon: <Color />, content: <AppearanceSettings /> },
  { value: "api", label: "API", icon: <Key />, content: <ApiSettings /> },
];

export type SettingsOverlayProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Settings over the whole window, on Appearance each time it opens; Escape,
 * the close button or a click outside the card closes it. Portalled to
 * <body> under Fluent's theme, so no ancestor's filter or transform can hold
 * Coral's fixed backdrop.
 */
export function SettingsOverlay({ open, onClose }: SettingsOverlayProps) {
  if (!open) return null;
  return (
    <Portal>
      <Overlay open onClose={onClose}>
        {/* mica-settings: solid with effects reduced (components/effects/effects.css). */}
        <Overlay.Menu className="mica-settings" label="Settings" onClose={onClose} items={PAGES} />
      </Overlay>
    </Portal>
  );
}
