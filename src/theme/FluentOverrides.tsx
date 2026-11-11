import { useSyncExternalStore, type ReactNode } from "react";
import { eventBus } from "@coral-ai/react";
import { FluentProvider } from "@fluentui/react-components";
import { GLOW_THEMES } from "./glowThemes";
import { useSkyeGlow } from "./skyeGlow";

const subscribeColorMode = (notify: () => void) => {
  eventBus.on("colorModeChanged", notify);
  return () => eventBus.off("colorModeChanged", notify);
};

/** Coral's colour mode, light or dark, as its provider resolves it. */
export const useColorMode = () => useSyncExternalStore(subscribeColorMode, () => eventBus.getColorMode());

/**
 * Lays the colour overrides of the Glow chosen in Settings (./glowThemes) over
 * Coral's theme for everything inside it. Coral's provider builds its theme
 * from the brand and colour mode alone, so a FluentProvider nested in it
 * carries them: Fluent merges a nested provider's theme over its parent's, and
 * its portals (menus, popovers, dialogs) take the merged tokens too. White has
 * none, so Coral's tokens come through. Transparent, as Coral's is, so the page
 * colour still comes from LumaSkyeBackground.
 */
export function FluentOverrides({ children }: { children: ReactNode }) {
  const mode = useColorMode();
  const glow = useSkyeGlow();
  return (
    <FluentProvider theme={GLOW_THEMES[glow].fluent[mode]} style={{ backgroundColor: "transparent" }}>
      {children}
    </FluentProvider>
  );
}
