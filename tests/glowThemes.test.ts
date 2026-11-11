// Glow in Settings, the app's colour theme: Neon's values untouched, White with
// no overrides, and the others at Neon's contrast in their own hues.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { skyeOrbPalettes } from "../src/components/orb/palettes.ts";
import { fluentOverrides } from "../src/theme/fluentColors.ts";
import { GLOW_THEMES, SKYE_GLOWS, glowCss, isSkyeGlow, type SkyeGlow } from "../src/theme/glowThemes.ts";
import { hexToOklch, turnHue } from "../src/theme/oklch.ts";

const glows = SKYE_GLOWS.map((glow) => glow.value);
const modes = ["light", "dark"] as const;
const turned: SkyeGlow[] = ["aurora", "seafoam", "iris"];

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

test("the choices are named as Settings shows them, Neon first", () => {
  assert.deepEqual(SKYE_GLOWS.map((glow) => glow.label), ["Neon", "White", "Aurora", "Seafoam", "Iris"]);
  assert.equal(glows[0], "neon");
});

test("only the known choices count as a remembered Glow", () => {
  assert.equal(isSkyeGlow("aurora"), true);
  assert.equal(isSkyeGlow("default"), false);
  assert.equal(isSkyeGlow("constructor"), false);
  assert.equal(isSkyeGlow(null), false);
});

test("Neon is fluentColors.ts verbatim, in coral.config.json's brand", () => {
  const coral = JSON.parse(readFileSync(new URL("../coral.config.json", import.meta.url), "utf8"));
  assert.equal(GLOW_THEMES.neon.fluent, fluentOverrides);
  assert.equal(GLOW_THEMES.neon.brand, coral.brand.color);
  assert.equal(GLOW_THEMES.neon.light.dark, "252, 249, 81");
});

test("White has no brand or Fluent overrides, under the original blue orb", () => {
  assert.equal(GLOW_THEMES.white.brand, undefined);
  assert.deepEqual(GLOW_THEMES.white.fluent, { light: {}, dark: {} });
  assert.equal(GLOW_THEMES.white.light.light, "255, 255, 255");
  assert.equal(skyeOrbPalettes.white.states?.thinking?.colorD, "#0F6FFF");
});

test("turning a colour keeps its lightness, its alpha and anything with no hue", () => {
  const start = hexToOklch("#427387");
  const end = hexToOklch(turnHue("#427387", 60));
  assert.ok(Math.abs(end.l - start.l) < 0.005);
  assert.ok(Math.abs(end.c - start.c) < 0.005);
  assert.ok(Math.abs(end.h - (start.h + 60)) < 2);
  assert.match(turnHue("rgba(51, 107, 131, 0.45)", 60), /^rgba\(\d+, \d+, \d+, 0\.45\)$/);
  assert.equal(turnHue("#FFFFFF", 60), "#FFFFFF");
  assert.equal(turnHue("var(--flight-mid)", 60), "var(--flight-mid)");
});

for (const glow of turned) {
  test(`${glow} overrides every token Neon does, at Neon's contrast`, () => {
    const theme = GLOW_THEMES[glow];
    for (const mode of modes) {
      const neon = fluentOverrides[mode] as Record<string, string>;
      const own = theme.fluent[mode] as Record<string, string>;
      assert.deepEqual(Object.keys(own), Object.keys(neon));
      for (const [foreground, background] of [
        ["colorNeutralForeground1", "colorNeutralBackground1"],
        ["colorNeutralForeground2", "colorNeutralBackground2"],
        ["colorNeutralForeground3", "colorNeutralBackground1"],
      ]) {
        const expected = contrast(neon[foreground], neon[background]);
        const actual = contrast(own[foreground], own[background]);
        assert.ok(Math.abs(actual - expected) < 0.75, `${mode} ${foreground}: ${actual} against ${expected}`);
      }
    }
  });

  test(`${glow} moves the UI off Neon's hue`, () => {
    const theme = GLOW_THEMES[glow];
    assert.notEqual(theme.brand, GLOW_THEMES.neon.brand);
    assert.notEqual(theme.board.dark["--flight-mid"], GLOW_THEMES.neon.board.dark["--flight-mid"]);
    assert.notEqual(theme.peek.litEdge, GLOW_THEMES.neon.peek.litEdge);
  });
}

for (const glow of glows) {
  test(`${glow}'s bars keep their labels readable`, () => {
    for (const mode of modes) {
      const board = GLOW_THEMES[glow].board[mode];
      for (const tone of ["pale", "mid", "deep"]) {
        const ratio = contrast(board[`--flight-${tone}-text`], board[`--flight-${tone}`]);
        assert.ok(ratio >= 4.5, `${mode} ${tone}: ${ratio.toFixed(2)}:1`);
      }
    }
  });

  test(`${glow}'s style sheet sets what the CSS reads, in both colour modes`, () => {
    const css = glowCss(GLOW_THEMES[glow]);
    assert.match(css, /prefers-color-scheme: dark/);
    for (const name of [
      "--agent-cursor-light",
      "--skye-chart-a",
      "--skye-chart-b",
      "--skye-chart-c",
      "--skye-peek-done-fill",
      "--skye-peek-lit-edge",
      "--skye-peek-lit-glow",
      "--flight-pale",
      "--flight-mid",
      "--flight-deep",
      "--flight-healthy",
      "--flight-outline",
    ]) {
      assert.equal(css.split(`${name}:`).length - 1, 2, name);
    }
  });

  test(`${glow}'s orb has strict hex colours in both states, as the renderer requires`, () => {
    const palette = skyeOrbPalettes[glow];
    const colors = [
      ...Object.values(palette.shared ?? {}),
      ...Object.values(palette.states?.thinking ?? {}),
      ...Object.values(palette.states?.idle ?? {}),
    ];
    assert.equal(colors.length, 17);
    for (const color of colors) assert.match(color, /^#[0-9A-F]{6}$/);
  });
}
