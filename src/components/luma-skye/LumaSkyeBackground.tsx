import { useCallback, useSyncExternalStore } from "react";
import { eventBus } from "@coral-ai/react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { useLiveCall } from "../../live";
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
  skye: { position: "absolute", inset: 0 },
  // Keep the resting tint visible on the light canvas, too.
  light: { opacity: 0.65 },
});

const subscribeColorMode = (notify: () => void) => {
  eventBus.on("colorModeChanged", notify);
  return () => eventBus.off("colorModeChanged", notify);
};

/** Luma's five-layer glow behind the whole shell, with Mica's actual call. */
export function LumaSkyeBackground() {
  const styles = useStyles();
  const colorMode = useSyncExternalStore(subscribeColorMode, () => eventBus.getColorMode());
  const live = useLiveCall();
  const state = skyeState(live.state, live.audioBlocked);
  const level = useCallback(
    () => live.voiceLevel(state === "speaking" ? "agent" : "user"),
    [live.voiceLevel, state],
  );
  return (
    <div className={styles.root} data-luma-background aria-hidden="true">
      <div className={mergeClasses(styles.skye, colorMode === "light" && styles.light)}>
        <VoiceSkye state={state} level={level} />
      </div>
    </div>
  );
}
