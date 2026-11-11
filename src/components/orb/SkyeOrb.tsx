import { LiveOrb, type LiveOrbProps } from "./LiveOrb";
import { useSkyeOrbPalette, useSkyeOrbStill } from "./skyeOrbLook";

/**
 * Skye's orb barely turns while she is quiet, 0.3× the opal orb's usual
 * speed, and races while she talks: 11 times that, 3.3× the usual speed. Any
 * speech above a quiet level (ORB_VOICE_FULL) counts as full voice, so it
 * reads as talking or not, rather than following each word (see LiveOrb).
 */
const ORB_SPEED = 0.3;
const ORB_VOICE_SPEEDUP = 10;
const ORB_VOICE_FULL = 0.15;

/**
 * Skye's orb, the one she is on screen wherever she goes: in her place in the
 * dock (AskInput), and out in the app (AgentCursor), which take it over from
 * each other. Her voice speeds it only: the speaking ring round it in the dock
 * marks her talking, without a glow swelling under it. In the Glow chosen in
 * Settings, the same here and there, so nothing jumps as she hands over.
 */
export function SkyeOrb({
  glow = true,
  speed = ORB_SPEED,
  voice,
  paused,
  placeholder,
}: Pick<LiveOrbProps, "glow" | "voice" | "speed" | "paused" | "placeholder">) {
  const palette = useSkyeOrbPalette();
  const still = useSkyeOrbStill();
  return (
    <LiveOrb
      size={32}
      glow={glow}
      speed={speed}
      voice={voice}
      paused={paused}
      placeholder={placeholder}
      voiceSpeedup={ORB_VOICE_SPEEDUP}
      voiceFull={ORB_VOICE_FULL}
      voiceGlow={false}
      state="thinking"
      preset="opal"
      palette={palette}
      still={still}
    />
  );
}
