// The app's Fluent colour overrides in the Neon Glow, laid over Coral's theme
// (its brand from coral.config.json, radii and fonts) by FluentOverrides. Change
// a value here and every Fluent component, makeStyles rule and var(--color…) in
// the app's CSS follows, popups included, as do Aurora, Seafoam and Iris, which
// are this table at other hues (glowThemes.ts). Each token has its light and
// dark value side by side; any other Fluent token (brand, palette) can be added
// the same way.
//
// The neutrals are Fluent's greys retinted to the slate teal of the EBC stand
// plan reference: a grey g becomes (g − 8, g + 1, g + 7) in dark, its darkest
// lifted a little, and (g − 6, g + 1, g + 5) in light, white staying white.
// The values noted below start from the reference instead. All are then eased
// a little darker and less saturated, in OKLCH: L − 0.012 and C × 0.75 in dark,
// L − 0.006 and C × 0.8 in light.
import type { Theme } from "@fluentui/react-components";

type ModeColors = { light: string; dark: string };

export const fluentColors: Partial<Record<keyof Theme, ModeColors>> = {
  // Foreground
  colorNeutralForeground1: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground1Hover: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground1Pressed: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground1Selected: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground2: { light: "#3C4144", dark: "#CCD3D7" },
  colorNeutralForeground2Hover: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground2Pressed: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground2Selected: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground3: { light: "#5A6063", dark: "#939A9E" }, // the reference's muted text
  colorNeutralForeground3Hover: { light: "#3C4144", dark: "#CCD3D7" },
  colorNeutralForeground3Pressed: { light: "#3C4144", dark: "#CCD3D7" },
  colorNeutralForeground3Selected: { light: "#3C4144", dark: "#CCD3D7" },
  colorNeutralForeground4: { light: "#696F72", dark: "#899094" },
  colorNeutralForeground5: { light: "#5A6063", dark: "#939A9E" },
  colorNeutralForeground5Hover: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground5Pressed: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground5Selected: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForegroundDisabled: { light: "#B6BCBF", dark: "#53595E" },
  colorNeutralForeground2Link: { light: "#3C4144", dark: "#CCD3D7" },
  colorNeutralForeground2LinkHover: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground2LinkPressed: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground2LinkSelected: { light: "#1E2327", dark: "#FFFFFF" },
  colorNeutralForeground1Static: { light: "#1E2327", dark: "#1D2225" },

  // Foreground, inverted
  colorNeutralForegroundStaticInverted: { light: "#FFFFFF", dark: "#FFFFFF" },
  colorNeutralForegroundInverted: { light: "#FFFFFF", dark: "#1D2225" },
  colorNeutralForegroundInvertedHover: { light: "#FFFFFF", dark: "#1D2225" },
  colorNeutralForegroundInvertedPressed: { light: "#FFFFFF", dark: "#1D2225" },
  colorNeutralForegroundInvertedSelected: { light: "#FFFFFF", dark: "#1D2225" },
  colorNeutralForegroundInverted2: { light: "#FFFFFF", dark: "#1D2225" },
  colorNeutralForegroundInvertedLink: { light: "#FFFFFF", dark: "#FFFFFF" },
  colorNeutralForegroundInvertedLinkHover: { light: "#FFFFFF", dark: "#FFFFFF" },
  colorNeutralForegroundInvertedLinkPressed: { light: "#FFFFFF", dark: "#FFFFFF" },
  colorNeutralForegroundInvertedLinkSelected: { light: "#FFFFFF", dark: "#FFFFFF" },

  // Background
  colorNeutralBackground1: { light: "#FFFFFF", dark: "#232A2E" },
  colorNeutralBackground1Hover: { light: "#EEF4F7", dark: "#343B3F" },
  colorNeutralBackground1Pressed: { light: "#D9DFE2", dark: "#1B2226" },
  colorNeutralBackground1Selected: { light: "#E4EAED", dark: "#30373B" },
  colorNeutralBackground2: { light: "#F3F9FC", dark: "#1B2226" },
  colorNeutralBackground2Hover: { light: "#E9EFF2", dark: "#2C3337" },
  colorNeutralBackground2Pressed: { light: "#D4DADD", dark: "#11181C" },
  colorNeutralBackground2Selected: { light: "#DFE5E8", dark: "#282F33" },
  colorNeutralBackground3: { light: "#EEF4F7", dark: "#11181C" },
  colorNeutralBackground3Hover: { light: "#E4EAED", dark: "#232A2E" },
  colorNeutralBackground3Pressed: { light: "#CFD5D8", dark: "#0A1015" },
  colorNeutralBackground3Selected: { light: "#D9DFE2", dark: "#1F262A" },
  colorNeutralBackground4: { light: "#E9EFF2", dark: "#0D1317" }, // content window, at 50% over Background5: #0B1115 in dark, the reference's #0B1419 eased
  colorNeutralBackground4Hover: { light: "#F3F9FC", dark: "#1B2226" },
  colorNeutralBackground4Pressed: { light: "#EEF4F7", dark: "#02070C" },
  colorNeutralBackground4Selected: { light: "#FFFFFF", dark: "#161D21" },
  colorNeutralBackground5: { light: "#E4EAED", dark: "#090F12" }, // page and title bar (LumaSkyeBackground, DesktopTitleBar)
  colorNeutralBackground5Hover: { light: "#EEF4F7", dark: "#11181C" },
  colorNeutralBackground5Pressed: { light: "#E9EFF2", dark: "#050B10" },
  colorNeutralBackground5Selected: { light: "#F3F9FC", dark: "#0D1418" },
  colorNeutralBackground6: { light: "#DFE5E8", dark: "#2C3337" },
  colorNeutralBackground7Hover: { light: "#E4EAED", dark: "#161D21" },
  colorNeutralBackground7Pressed: { light: "#CFD5D8", dark: "#0A1015" },
  colorNeutralBackground8: { light: "#F5FBFC", dark: "#232A2E" },

  // Background, inverted and static
  colorNeutralBackgroundInverted: { light: "#23282B", dark: "#FFFFFF" },
  colorNeutralBackgroundInvertedHover: { light: "#373C3F", dark: "#EBF2F6" },
  colorNeutralBackgroundInvertedPressed: { light: "#191E22", dark: "#D6DDE1" },
  colorNeutralBackgroundInvertedSelected: { light: "#32373A", dark: "#E1E8EC" },
  colorNeutralBackgroundStatic: { light: "#2D3235", dark: "#343B3F" },

  // Translucent backgrounds and the dialog overlay
  colorNeutralBackgroundAlpha: { light: "rgba(255, 255, 255, 0.5)", dark: "rgba(22, 29, 33, 0.5)" },
  colorNeutralBackgroundAlpha2: { light: "rgba(255, 255, 255, 0.8)", dark: "rgba(27, 34, 38, 0.7)" },
  colorSubtleBackgroundLightAlphaHover: { light: "rgba(255, 255, 255, 0.7)", dark: "rgba(31, 38, 42, 0.8)" },
  colorSubtleBackgroundLightAlphaPressed: { light: "rgba(255, 255, 255, 0.5)", dark: "rgba(31, 38, 42, 0.5)" },
  colorBackgroundOverlay: { light: "rgba(11, 18, 22, 0.4)", dark: "rgba(4, 7, 10, 0.6)" },

  // Subtle (transparent at rest) backgrounds
  colorSubtleBackgroundHover: { light: "#EEF4F7", dark: "#30373B" },
  colorSubtleBackgroundPressed: { light: "#D9DFE2", dark: "#282F33" },
  colorSubtleBackgroundSelected: { light: "#E4EAED", dark: "#2C3337" },

  // Cards
  colorNeutralCardBackground: { light: "#F3F9FC", dark: "#2C3337" },
  colorNeutralCardBackgroundHover: { light: "#FFFFFF", dark: "#343B3F" },
  colorNeutralCardBackgroundPressed: { light: "#EEF4F7", dark: "#282F33" },
  colorNeutralCardBackgroundSelected: { light: "#E4EAED", dark: "#30373B" },
  colorNeutralCardBackgroundDisabled: { light: "#E9EFF2", dark: "#11181C" },

  // Disabled
  colorNeutralBackgroundDisabled: { light: "#E9EFF2", dark: "#11181C" },
  colorNeutralBackgroundDisabled2: { light: "#FFFFFF", dark: "#232A2E" },
  colorNeutralStrokeDisabled: { light: "#D9DFE2", dark: "#393F44" },
  colorNeutralStrokeDisabled2: { light: "#E4EAED", dark: "#343B3F" },

  // Skeleton stencils
  colorNeutralStencil1: { light: "#DFE5E8", dark: "#4E5459" },
  colorNeutralStencil2: { light: "#F3F9FC", dark: "#2C3337" },

  // Strokes
  colorNeutralStrokeAccessible: { light: "#5A6063", dark: "#A3AAAE" },
  colorNeutralStrokeAccessibleHover: { light: "#515659", dark: "#B3BABE" },
  colorNeutralStrokeAccessiblePressed: { light: "#474C4F", dark: "#A9B0B4" },
  colorNeutralStroke1: { light: "#CAD0D3", dark: "#5D6368" },
  colorNeutralStroke1Hover: { light: "#C0C6C9", dark: "#6B7277" },
  colorNeutralStroke1Pressed: { light: "#ACB2B5", dark: "#61686D" },
  colorNeutralStroke1Selected: { light: "#B6BCBF", dark: "#666D72" },
  colorNeutralStroke2: { light: "#D9DFE2", dark: "#262D30" }, // the reference's dividers and card borders
  colorNeutralStroke3: { light: "#E9EFF2", dark: "#1F262A" }, // the board's grid; fainter than Stroke2
  colorNeutralStroke4: { light: "#E4EAED", dark: "#343B3F" },
  colorNeutralStroke4Hover: { light: "#D9DFE2", dark: "#282F33" },
  colorNeutralStroke4Pressed: { light: "#CFD5D8", dark: "#1F262A" },
  colorNeutralStroke4Selected: { light: "#E4EAED", dark: "#343B3F" },
  colorNeutralStrokeSubtle: { light: "#D9DFE2", dark: "#0A1015" },
};

const pick = (mode: keyof ModeColors): Partial<Theme> =>
  Object.fromEntries(Object.entries(fluentColors).map(([token, colors]) => [token, colors[mode]]));

/** The overrides by colour mode, as FluentOverrides applies them. */
export const fluentOverrides = { light: pick("light"), dark: pick("dark") } as const;
