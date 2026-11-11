import { useSkyeGlow } from "../../theme/skyeGlow";
import type { SkyeGlow } from "../../theme/glowThemes";
import { skyeOrbPalettes, type OrbPalette } from "./palettes";
import neon from "../../assets/skye-orb-neon.png";
import white from "../../assets/skye-orb-white.png";
import aurora from "../../assets/skye-orb-aurora.png";
import seafoam from "../../assets/skye-orb-seafoam.png";
import iris from "../../assets/skye-orb-iris.png";

/**
 * Stills of Skye's orb in each Glow: the opal preset in that Glow's palette,
 * thinking, as LiveOrb draws it (its canvas, overhang and all, at 200px, 2x),
 * captured from the running renderer. For LiveOrb's `still`, and wherever Skye
 * shows as a picture rather than live (the Outputs panel's avatars).
 */
const stills: Readonly<Record<SkyeGlow, string>> = { neon, white, aurora, seafoam, iris };

/** Skye's orb's colours in the Glow chosen in Settings. */
export const useSkyeOrbPalette = (): OrbPalette => skyeOrbPalettes[useSkyeGlow()];

/** The still of Skye's orb in the Glow chosen in Settings. */
export const useSkyeOrbStill = (): string => stills[useSkyeGlow()];
