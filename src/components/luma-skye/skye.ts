/*
 * Luma's skye: light rising from the bottom of the screen that answers the
 * voice (`VoiceSkye`). Not in Figma. Built from the owner's reference images
 * (16 Oct 2026):
 *
 * - Body (reference 1): a saturated wave with a pale wave beneath it, both
 *   blurred by 160–200px and blended "plus lighter" at 80%. That gives a dark
 *   top, colour rising from the bottom and a near-white edge. Each blurred wave
 *   is an elliptical radial gradient here: it looks the same as a blurred shape
 *   and costs far less than a live blur.
 * - Rim (references 2 and 3): a frame lit from below by four stacked inner
 *   shadows: deep (y −70, blur 60, spread −30), light at 50% (−40, 30, −10),
 *   white at 30% "plus lighter" (−20, 20, −5) and a thin edge at 15% (−6, 6, −2).
 *   Figma's inner shadows map one to one onto CSS inset box shadows.
 */

/** Channels as `'r, g, b'`, so each layer can set its own alpha. */
export interface SkyePalette {
  /** The saturated wave, and the rim's outer shadow. */
  deep: string
  /** Where the waves meet, and the rim's second shadow. */
  light: string
  /** The pale wave along the edge. */
  core: string
  /** The rim's thin innermost line. */
  edge: string
}

export const skyePalettes = {
  /** The default: reference 1's look leaned toward the blue of references 2 and 3 (hue about 234°; violet is 255°, blue 222°), at the owner's request. */
  luma: { deep: '42, 58, 208', light: '108, 130, 255', core: '238, 242, 255', edge: '56, 82, 255' },
  /** Reference 1: a violet wave (#5028CC) over a pale pink one (#FFF0FF). `light` and `edge` are picked to match it. */
  violet: { deep: '80, 40, 204', light: '140, 108, 255', core: '255, 240, 255', edge: '106, 61, 255' },
  /** References 2 and 3: #134BCD, #6D99FF at 50%, white and #1F62FF. */
  blue: { deep: '19, 75, 205', light: '109, 153, 255', core: '255, 255, 255', edge: '31, 98, 255' },
} as const satisfies Record<string, SkyePalette>

export type SkyePaletteName = keyof typeof skyePalettes

const rgba = (channels: string, alpha: number) => `rgba(${channels}, ${alpha})`

/** A heavily blurred edge: alpha falls off roughly like a Gaussian, so the ellipse has no visible rim. */
const falloff = (channels: string, peak: number) =>
  (
    [
      [1, 0],
      [0.82, 18],
      [0.56, 36],
      [0.31, 54],
      [0.13, 70],
      [0.04, 85],
      [0, 100],
    ] as const
  )
    .map(([alpha, at]) => `${rgba(channels, Math.round(alpha * peak * 1000) / 1000)} ${at}%`)
    .join(', ')

/**
 * The skye's layers, bottom to top, each anchored to the bottom edge. The body
 * layers (all but the rim) are drawn on a box `skyeBodyWidth` times the
 * screen's width, so they can sway without showing their sides; the rim is
 * drawn on the screen's own box.
 */
export function skyeLayers(palette: SkyePalette) {
  return {
    /** The saturated wave: a wide dome. */
    wave: `radial-gradient(ellipse 48% 100% at 50% 100%, ${falloff(palette.deep, 0.7)})`,
    /** A narrower crest right of centre, so the wave isn't symmetrical (reference 1). */
    crest: `radial-gradient(ellipse 26% 80% at 62% 100%, ${falloff(palette.deep, 0.45)})`,
    /** Inner shadows along the bottom edge (references 2 and 3). */
    rim: [
      `inset 0 -70px 60px -30px ${rgba(palette.deep, 1)}`,
      `inset 0 -40px 30px -10px ${rgba(palette.light, 0.5)}`,
      `inset 0 -20px 20px -5px ${rgba(palette.core, 0.3)}`,
      `inset 0 -6px 6px -2px ${rgba(palette.edge, 0.15)}`,
    ].join(', '),
    /** Where the waves meet. Blended plus lighter. */
    glow: `radial-gradient(ellipse 40% 55% at 50% 100%, ${falloff(palette.light, 0.45)})`,
    /** The pale wave hugging the edge. Blended plus lighter. */
    core: `radial-gradient(ellipse 30% 13% at 50% 100%, ${falloff(palette.core, 0.4)})`,
  }
}

/** How much wider than the screen the body layers are drawn. */
export const skyeBodyWidth = 1.5

/**
 * The skye at full strength as one still background, for any surface lit from
 * below. Spread into a `makeStyles` rule on a dark surface whose bottom is the
 * screen's bottom. `screen` stands in for "plus lighter", which backgrounds
 * can't use.
 */
export function skyeBackground(palette: SkyePalette = skyePalettes.luma) {
  const { wave, crest, glow, core } = skyeLayers(palette)
  return {
    backgroundImage: [core, glow, crest, wave].join(', '),
    backgroundBlendMode: 'screen, screen, normal, normal',
    backgroundSize: `${skyeBodyWidth * 100}% 100%`,
    backgroundPosition: '50% 100%',
    backgroundRepeat: 'no-repeat',
  }
}
