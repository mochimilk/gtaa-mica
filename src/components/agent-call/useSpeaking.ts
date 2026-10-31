import * as React from "react";

/** Voice level (0–1, see VoiceMeter) that counts as talking, and how long it holds after. */
const SPEAKING_LEVEL = 0.5;
const SPEAKING_HOLD_MS = 400;
const SPEAKING_SAMPLE_MS = 100;

/**
 * Whether a call audio level reads as talking, sampled a few times a second,
 * as Teams lights a speaker's tile. Re-renders only when the answer changes.
 * Not `active` (no call to hear), it reads false and samples nothing.
 */
export function useSpeaking(level: () => number, active = true): boolean {
  const [speaking, setSpeaking] = React.useState(false);
  React.useEffect(() => {
    if (!active) {
      setSpeaking(false);
      return undefined;
    }
    let lastHeard = -Infinity;
    const timer = setInterval(() => {
      const now = performance.now();
      if (level() >= SPEAKING_LEVEL) lastHeard = now;
      setSpeaking(now - lastHeard < SPEAKING_HOLD_MS);
    }, SPEAKING_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [level, active]);
  return speaking;
}
