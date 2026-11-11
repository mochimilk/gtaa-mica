// Glow in Settings' Appearance page is the app's whole colour theme: Skye's
// light (her orb's glow and the ring round it, her echoes, the tethers), the
// outline on what she selects, the glow along the page's foot, the board's
// bars, the Outputs peek and every Fluent token and brand colour in the UI.
// Her orb's own colours and stills go with it (components/orb/palettes.ts,
// skyeOrbLook.ts); skyeGlow.ts holds the choice and applies it.
//
// Neon is the look the rest are made from: its neutrals are fluentColors.ts,
// verbatim, with its other values here. Aurora, Seafoam and Iris are all of it
// turned to another hue at the same lightness and chroma (`turned`), so their
// contrast stays as Neon's does, with their own light, outline and glow. White
// is the app's first look, in Coral's own Fluent colours, with no overrides.
import type { Theme } from "@fluentui/react-components";
import { skyePalettes, type SkyePalette } from "../components/luma-skye/skye";
import { fluentOverrides } from "./fluentColors";
import { hexToOklch, turnHue } from "./oklch";

export type SkyeGlow = "neon" | "white" | "aurora" | "seafoam" | "iris";

type Mode = "light" | "dark";
type ByMode<T> = Record<Mode, T>;

export interface GlowTheme {
  /** Its name in Settings. */
  label: string;
  /** Skye's light, as channels (--agent-cursor-light, agent-cursor.css). */
  light: ByMode<string>;
  /** The brand Coral builds its Fluent theme from; none leaves Coral's own. */
  brand?: string;
  /** Laid over Coral's theme by FluentOverrides. */
  fluent: ByMode<Partial<Theme>>;
  /** The glow along the page's foot (VoiceSkye). */
  skye: SkyePalette;
  /** The board's bars and outlines (demo.css), as CSS custom properties. */
  board: ByMode<Record<string, string>>;
  /**
   * What Skye has selected on the board and in the lists (skyeGlow.css,
   * operations.css): deepened from her light, so it stands out on the bars and
   * the page. The first is its main colour.
   */
  chart: readonly [string, string, string];
  /** The Outputs peek once Skye is done: its fill in dark mode and the light rising in it. */
  peek: { doneFill: string; litEdge: string; litGlow: string };
}

const mapValues = <T extends Record<string, string>>(values: T, map: (value: string) => string) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, map(value)])) as T;

/*
 * A healthy stay's tones by aircraft type (demo.css, theme.tsx), the EBC stand
 * plan reference's lightness ramp: pale, mid and deep, solid, inside an edge of
 * the same colour (pale's darker on the light board, where its fill is paler),
 * each with its own text colour (labels and the aircraft drawing) and tow/hold
 * stripe, chosen away from the text so contrast only rises. Neon's text: pale's
 * ink ≈ 6.1:1 dark, ≈ 10.4:1 light; mid's white ≈ 7.2:1; deep's white ≈ 14.2:1.
 * Deep sits only ≈ 1.3:1 off the dark board, as in the reference; its labels
 * carry it. --flight-healthy is the healthy colour where a status is marked
 * beside the chart, deepened in light mode for ≥ 3:1 on white; --flight-outline
 * is selected, linked and focus.
 */
const NEON_BOARD_LIGHT = {
  "--flight-pale": "#9acae0",
  "--flight-pale-edge": "#679cb5",
  "--flight-pale-text": "#07161c",
  "--flight-pale-hatch": "#07161c",
  "--flight-mid": "#3a5c6b",
  "--flight-mid-edge": "var(--flight-mid)",
  "--flight-mid-text": "#ffffff",
  "--flight-mid-hatch": "#000000",
  "--flight-deep": "#152e39",
  "--flight-deep-edge": "var(--flight-deep)",
  "--flight-deep-text": "#ffffff",
  "--flight-deep-hatch": "#000000",
  "--flight-healthy": "#5a899e",
  "--flight-outline": "#091318",
};

/** Brighter, so the colours read off dark surfaces; mid and deep are as on the light board. */
const NEON_BOARD_DARK = {
  ...NEON_BOARD_LIGHT,
  "--flight-pale": "#679cb5",
  "--flight-pale-edge": "var(--flight-pale)",
  "--flight-pale-hatch": "#ffffff",
  "--flight-healthy": "#78b6d2",
  "--flight-outline": "#e0f1f4",
};

const NEON: GlowTheme = {
  label: "Neon",
  light: { light: "252, 249, 81", dark: "252, 249, 81" },
  brand: "#427387",
  fluent: fluentOverrides,
  skye: skyePalettes.luma,
  board: { light: NEON_BOARD_LIGHT, dark: NEON_BOARD_DARK },
  chart: ["#F5D800", "#B8E000", "#E0FF4F"],
  peek: { doneFill: "#020B10", litEdge: "rgba(92, 156, 184, 1)", litGlow: "rgba(51, 107, 131, 0.45)" },
};

/** The hue Neon's UI sits at, which the others turn from. */
const NEON_HUE = hexToOklch(NEON.brand!).h;

/** Neon's UI, turned to `hue`, in its own light, outline and glow. */
function turned(hue: number, theme: Pick<GlowTheme, "label" | "light" | "skye" | "chart">): GlowTheme {
  const turn = (color: string) => turnHue(color, hue - NEON_HUE);
  return {
    ...theme,
    brand: turn(NEON.brand!),
    fluent: {
      light: mapValues(NEON.fluent.light as Record<string, string>, turn),
      dark: mapValues(NEON.fluent.dark as Record<string, string>, turn),
    },
    board: { light: mapValues(NEON.board.light, turn), dark: mapValues(NEON.board.dark, turn) },
    peek: mapValues(NEON.peek, turn),
  };
}

const WHITE_BOARD_LIGHT = {
  "--flight-pale": "#b9c0f0",
  "--flight-pale-edge": "#8993d8",
  "--flight-pale-text": "#000b3f",
  "--flight-pale-hatch": "#000b3f",
  "--flight-mid": "#4b549b",
  "--flight-mid-edge": "var(--flight-mid)",
  "--flight-mid-text": "#ffffff",
  "--flight-mid-hatch": "#000000",
  "--flight-deep": "#1a285e",
  "--flight-deep-edge": "var(--flight-deep)",
  "--flight-deep-text": "#ffffff",
  "--flight-deep-hatch": "#000000",
  "--flight-healthy": "#6a89dc",
  "--flight-outline": "#08151b",
};

export const GLOW_THEMES: Readonly<Record<SkyeGlow, GlowTheme>> = {
  neon: NEON,
  white: {
    label: "White",
    light: { light: "255, 255, 255", dark: "255, 255, 255" },
    fluent: { light: {}, dark: {} },
    skye: skyePalettes.original,
    board: {
      light: WHITE_BOARD_LIGHT,
      dark: {
        ...WHITE_BOARD_LIGHT,
        "--flight-pale": "#8993d8",
        "--flight-pale-edge": "var(--flight-pale)",
        "--flight-pale-hatch": "#ffffff",
        "--flight-healthy": "#93adf4",
        "--flight-outline": "#dff6fa",
      },
    },
    chart: ["#0F6FFF", "#7A5CFF", "#14B8E0"],
    peek: { doneFill: "#05051D", litEdge: "rgba(150, 138, 240, 1)", litGlow: "rgba(84, 84, 228, 0.45)" },
  },
  // The northern lights' blue-violet, over violet slate.
  aurora: turned(287, {
    label: "Aurora",
    light: { light: "92, 64, 224", dark: "156, 136, 255" },
    skye: skyePalettes.violet,
    chart: ["#7A5CFF", "#B45CFF", "#4FD1E0"],
  }),
  // A bright sea-green, over green slate.
  seafoam: turned(177, {
    label: "Seafoam",
    light: { light: "0, 155, 125", dark: "80, 240, 190" },
    skye: skyePalettes.seafoam,
    chart: ["#00C896", "#14B8A6", "#5EEAD4"],
  }),
  // A soft sky blue, over blue slate.
  iris: turned(257, {
    label: "Iris",
    light: { light: "66, 150, 235", dark: "140, 200, 255" },
    skye: skyePalettes.blue,
    chart: ["#3B9BFF", "#6F8CFF", "#5CC8FF"],
  }),
};

/** The choices, in the order Settings shows them. */
export const SKYE_GLOWS: readonly { value: SkyeGlow; label: string }[] = (
  ["neon", "white", "aurora", "seafoam", "iris"] as const
).map((value) => ({ value, label: GLOW_THEMES[value].label }));

export const isSkyeGlow = (value: unknown): value is SkyeGlow =>
  typeof value === "string" && Object.hasOwn(GLOW_THEMES, value);

const declarations = (theme: GlowTheme, mode: Mode) =>
  Object.entries({
    "--agent-cursor-light": theme.light[mode],
    "--skye-chart-a": theme.chart[0],
    "--skye-chart-b": theme.chart[1],
    "--skye-chart-c": theme.chart[2],
    "--skye-peek-done-fill": theme.peek.doneFill,
    "--skye-peek-lit-edge": theme.peek.litEdge,
    "--skye-peek-lit-glow": theme.peek.litGlow,
    ...theme.board[mode],
  })
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");

/**
 * What a theme sets outside Fluent's tokens, as a style sheet on the root, so
 * Skye's layers portalled to <body> take it too. It switches on the system's
 * colour scheme, as the app's other prefers-color-scheme rules do.
 */
export const glowCss = (theme: GlowTheme) =>
  `:root { ${declarations(theme, "light")} }\n@media (prefers-color-scheme: dark) { :root { ${declarations(theme, "dark")} } }`;
