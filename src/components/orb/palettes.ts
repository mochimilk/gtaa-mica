import type { SkyeGlow } from "../../theme/glowThemes";
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
 * Skye's orb, an iridescent opal, in each Glow (theme/glowThemes.ts). Colour D
 * is its main colour and its glow; the background tint is a deep shade of its
 * hue rather than black. Each one's idle is the same palette muted the way
 * upstream mutes opal (0.3× saturation, 0.74× lightness). A change here needs
 * its still taken again (skyeOrbLook.ts).
 */

/* Neon yellow (#FCF951), with pale lemon, chartreuse (#E0FF4F) and a deeper lime. */
const neon: OrbPalette = {
  shared: {
    shellMid: "#F4FFC2",
    shellEdge: "#F0FF8A",
    sheenColor: "#FFFDE8",
    specColor: "#FFF7C7",
    canvasColor: "#3A3200",
  },
  states: {
    thinking: {
      colorA: "#FFFDE0",
      colorB: "#B2E61F",
      colorC: "#E0FF4F",
      colorD: "#FCF951",
      highlightColor: "#FFFFFF",
      glowColor: "#FCF951",
    },
    idle: {
      colorA: "#C9C69A",
      colorB: "#6C7849",
      colorC: "#94A157",
      colorD: "#9F9E57",
      highlightColor: "#ECEADC",
      glowColor: "#9F9E57",
    },
  },
};

/* The original orb, blue and white. Thinking colours A–D and the highlight were picked in the upstream orb editor. */
const white: OrbPalette = {
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

/* Blue-violet, with the northern lights' mint running through it. */
const aurora: OrbPalette = {
  shared: {
    shellMid: "#E3DEFF",
    shellEdge: "#BDB0FF",
    sheenColor: "#F2EEFF",
    specColor: "#E6E0FF",
    canvasColor: "#1A1148",
  },
  states: {
    thinking: {
      colorA: "#E6E0FF",
      colorB: "#A6F0E4",
      colorC: "#B49BFF",
      colorD: "#6E4BFF",
      highlightColor: "#FFFFFF",
      glowColor: "#6E4BFF",
    },
    idle: {
      colorA: "#A39AC9",
      colorB: "#80ADA5",
      colorC: "#8879B7",
      colorD: "#64559F",
      highlightColor: "#E4E0EC",
      glowColor: "#64559F",
    },
  },
};

/* A bright sea-green, with pale mint and a deeper jade. */
const seafoam: OrbPalette = {
  shared: {
    shellMid: "#D2FFEF",
    shellEdge: "#A2F0D4",
    sheenColor: "#EAFFF7",
    specColor: "#D6FFF0",
    canvasColor: "#06342A",
  },
  states: {
    thinking: {
      colorA: "#DFFFF3",
      colorB: "#C4FAEA",
      colorC: "#05A07C",
      colorD: "#2FE0AE",
      highlightColor: "#FFFFFF",
      glowColor: "#2FE0AE",
    },
    idle: {
      colorA: "#99C8B7",
      colorB: "#8EBCAE",
      colorC: "#2C4E46",
      colorD: "#4E7B6E",
      highlightColor: "#DCECE6",
      glowColor: "#4E7B6E",
    },
  },
};

/* A soft sky blue, with pale ice and periwinkle. */
const iris: OrbPalette = {
  shared: {
    shellMid: "#D8EBFF",
    shellEdge: "#AFD2FF",
    sheenColor: "#EEF6FF",
    specColor: "#DEEEFF",
    canvasColor: "#0E2A4A",
  },
  states: {
    thinking: {
      colorA: "#DCEEFF",
      colorB: "#BFE3FF",
      colorC: "#8FB4FF",
      colorD: "#4AA3F0",
      highlightColor: "#FFFFFF",
      glowColor: "#4AA3F0",
    },
    idle: {
      colorA: "#98B0C8",
      colorB: "#8AA8C0",
      colorC: "#7388B4",
      colorD: "#577692",
      highlightColor: "#DCE6F0",
      glowColor: "#577692",
    },
  },
};

export const skyeOrbPalettes: Readonly<Record<SkyeGlow, OrbPalette>> = { neon, white, aurora, seafoam, iris };
