import { useCallback, useEffect, useSyncExternalStore } from "react";
import { eventBus } from "@coral-ai/react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { useLiveCall } from "../../live";
import { GLOW_THEMES } from "../../theme/glowThemes";
import { useSkyeGlow } from "../../theme/skyeGlow";
import { holdAwake, useReduceEffects } from "../effects";
import { hasDesktopBackdrop } from "../title-bar";
import { VoiceSkye } from "./VoiceSkye";
import { skyeState } from "./state";

const useStyles = makeStyles({
  root: {
    position: "fixed",
    inset: 0,
    // Behind every control/portal layer. It paints the page colour
    // (colorNeutralBackground5) over Coral's body (colorNeutralBackground4):
    // the body sits outside the Fluent theme, so its tokens don't resolve there.
    zIndex: -1,
    pointerEvents: "none",
    backgroundColor: tokens.colorNeutralBackground5,
  },
  // On Mica the window paints the page (hasDesktopBackdrop), tinted below.
  // A band rises from the bottom at 80%, colorNeutralBackground5 into
  // colorNeutralBackground4, gone a third of the way up, so Skye's glow along
  // the bottom reads clearly over the wallpaper.
  backdrop: {
    backgroundImage: `linear-gradient(to top, color-mix(in srgb, ${tokens.colorNeutralBackground5} 80%, transparent), color-mix(in srgb, ${tokens.colorNeutralBackground4} 80%, transparent) 16.667%, transparent 33.333%)`,
  },
  // Mica's tint: black at half in the dark theme, white at half in the light.
  backdropDark: { backgroundColor: "rgb(0 0 0 / 0.5)" },
  backdropLight: { backgroundColor: "rgb(255 255 255 / 0.5)" },
  skye: { position: "absolute", inset: 0 },
  // Keep the resting tint visible on the light canvas, too.
  light: { opacity: 0.65 },
});

const subscribeColorMode = (notify: () => void) => {
  eventBus.on("colorModeChanged", notify);
  return () => eventBus.off("colorModeChanged", notify);
};

/**
 * Luma's five-layer glow behind the whole shell, with Mica's actual call.
 * While the call is on or Skye is working, the app stays awake
 * (components/effects), so nothing of hers pauses mid-way; with effects
 * reduced, the glow holds still.
 */
export function LumaSkyeBackground() {
  const styles = useStyles();
  const colorMode = useSyncExternalStore(subscribeColorMode, () => eventBus.getColorMode());
  const live = useLiveCall();
  const state = skyeState(live.state, live.audioBlocked);
  const level = useCallback(
    () => live.voiceLevel(state === "speaking" ? "agent" : "user"),
    [live.voiceLevel, state],
  );
  const busy = state !== "idle" && state !== "unavailable";
  useEffect(() => (busy ? holdAwake() : undefined), [busy]);
  const reduceEffects = useReduceEffects();
  const palette = GLOW_THEMES[useSkyeGlow()].skye;
  const backdrop = hasDesktopBackdrop();
  return (
    <div
      className={mergeClasses(
        styles.root,
        backdrop && styles.backdrop,
        backdrop && (colorMode === "light" ? styles.backdropLight : styles.backdropDark),
      )}
      data-luma-background
      aria-hidden="true"
    >
      <div className={mergeClasses(styles.skye, colorMode === "light" && styles.light)}>
        <VoiceSkye state={state} level={level} palette={palette} still={reduceEffects} />
      </div>
    </div>
  );
}
