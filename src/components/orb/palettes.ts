import type { OrbStateColorKey, OrbStateName } from "./engine/orb-states";
import type { OrbParams } from "./engine/presets";

/** Colours that differ per state; they animate when the state changes. */
export type OrbStateColors = Partial<Pick<OrbParams, OrbStateColorKey>>;

/** Colours shared by every state: the glass shell and the background tint. */
export type OrbSharedColors = Partial<
  Pick<OrbParams, "shellInner" | "shellMid" | "shellEdge" | "sheenColor" | "specColor" | "canvasColor">
>;

/** Colour overrides applied on top of a preset, without touching the engine. */
export type OrbPalette = {
  shared?: OrbSharedColors;
  states?: Partial<Record<OrbStateName, OrbStateColors>>;
};

/*
 * Iridescent opal. Thinking colours A–D and the highlight were picked in the
 * upstream orb editor. The background tint is a deep navy (#111148) rather
 * than black. Idle is the same palette muted the way upstream mutes opal
 * (about 0.3× saturation, 0.74× lightness).
 */
export const gtaaOpal: OrbPalette = {
  shared: {
    shellMid: "#D3DBFF",
    shellEdge: "#AEB9FF",
    sheenColor: "#EAF0FF",
    specColor: "#DCE4FF",
    canvasColor: "#111148",
  },
  states: {
    thinking: {
      colorA: "#B2CDFB",
      colorB: "#BBEFF7",
      colorC: "#A7A4EA",
      colorD: "#0F6FFF",
      highlightColor: "#FFFFFF",
      glowColor: "#0F6FFF",
    },
    idle: {
      colorA: "#8598B9",
      colorB: "#8AB1B7",
      colorC: "#817FA7",
      colorD: "#465E82",
      highlightColor: "#DCE0EC",
      glowColor: "#465E82",
    },
  },
};
