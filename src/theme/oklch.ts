// OKLCH, for moving a colour round to another hue at the same lightness and
// chroma, so it keeps its contrast with what sits beside it (glowThemes.ts).

export type Oklch = { l: number; c: number; h: number };

const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const toSrgb = (value: number) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);

/** Below this chroma a colour has no hue worth keeping: white, black and true greys stay as they are. */
const ACHROMATIC = 0.004;

function channelsToOklch(r: number, g: number, b: number): Oklch {
  const [lr, lg, lb] = [r, g, b].map((channel) => toLinear(channel / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b2 = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, b2),
    h: ((Math.atan2(b2, a) * 180) / Math.PI + 360) % 360,
  };
}

/** Linear sRGB for an OKLCH colour; outside 0 to 1 when it is out of gamut. */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b];
  const [x, y, z] = lms.map((value) => value ** 3);
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ];
}

const inGamut = (rgb: readonly number[]) => rgb.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);

/** The colour's sRGB channels, 0 to 255, its chroma eased just enough to fit the gamut. */
function oklchToChannels(color: Oklch): [number, number, number] {
  let rgb = oklchToLinear(color);
  if (!inGamut(rgb)) {
    let [low, high] = [0, color.c];
    for (let step = 0; step < 24; step += 1) {
      const c = (low + high) / 2;
      if (inGamut(oklchToLinear({ ...color, c }))) low = c;
      else high = c;
    }
    rgb = oklchToLinear({ ...color, c: low });
  }
  const [r, g, b] = rgb.map((channel) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.max(0, channel)))) * 255));
  return [r, g, b];
}

export function hexToOklch(hex: string): Oklch {
  const value = hex.slice(1);
  return channelsToOklch(
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  );
}

const moved = (color: Oklch, degrees: number, chroma: number): Oklch =>
  color.c < ACHROMATIC ? color : { l: color.l, c: color.c * chroma, h: (color.h + degrees + 360) % 360 };

/**
 * `color` turned by `degrees` of hue, its chroma scaled by `chroma`. Takes
 * `#rrggbb` and `rgba(r, g, b, a)`, keeping the alpha; anything else, such as a
 * `var()`, comes back unchanged, as do colours with no hue to turn.
 */
export function turnHue(color: string, degrees: number, chroma = 1): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const start = hexToOklch(color);
    if (start.c < ACHROMATIC) return color;
    const channels = oklchToChannels(moved(start, degrees, chroma));
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(color);
  if (rgba) {
    const start = channelsToOklch(Number(rgba[1]), Number(rgba[2]), Number(rgba[3]));
    if (start.c < ACHROMATIC) return color;
    const [r, g, b] = oklchToChannels(moved(start, degrees, chroma));
    return `rgba(${r}, ${g}, ${b}, ${rgba[4]})`;
  }
  return color;
}
