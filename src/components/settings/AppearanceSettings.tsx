// Settings' Appearance page, after Coral's Settings design (Figma: Coral,
// Overlay.Menu): under the page's name, as the API page has it, a list of its
// settings, a hairline under each. The board's Timeline comes first, its name
// over cards previewing each style (the operations context's flightStyle).
// The rest are a row each, the name on the left and the control on the
// right: the theme, visual only for now (the app's look follows the system's,
// in Fluent's tokens and in the prefers-color-scheme rules alike); Glow, the
// app's colour theme, Skye's orb and light with it (theme/glowThemes.ts);
// Tethers, whether lines join Skye to her helpers (agent-cursor/skyeTethers.ts);
// Noise, the app's film grain (components/grain); and Reduce effects, the
// look for slower machines (components/effects). Each choice applies as it is
// made, behind the overlay.
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { PillTab, PillTabList } from "@coral-ai/react";
import { Desktop } from "@coral-ai/bundleicons/Desktop";
import { WeatherMoon } from "@coral-ai/bundleicons/WeatherMoon";
import { WeatherSunny } from "@coral-ai/bundleicons/WeatherSunny";
import {
  Caption1,
  Dropdown,
  Label,
  Option,
  Switch,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import type { FluentIcon } from "@fluentui/react-icons";
import { setSkyeTethers, useSkyeTethers } from "../agent-cursor";
import { useColorMode } from "../../theme/FluentOverrides";
import { GLOW_THEMES, SKYE_GLOWS, type SkyeGlow } from "../../theme/glowThemes";
import { setSkyeGlow, useSkyeGlow } from "../../theme/skyeGlow";
import { setReduceEffects, useReduceEffects } from "../effects";
import { setGrain, useGrain } from "../grain";
import { useOperations } from "../../operations/OperationsContext";
import { barPath, type BarBox } from "../../stand-timeline";
import {
  BAR_INSET,
  BAR_RADIUS,
  END_SHAPE,
  FLIGHT_STYLE_LABEL,
  ROW_HEIGHT,
  type FlightStyle,
} from "../../stand-timeline-demo/theme";

const useStyles = makeStyles({
  // As the API page's: the page's name, then its settings.
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  list: {
    display: "flex",
    flexDirection: "column",
  },
  timeline: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalL,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalL,
    boxSizing: "border-box",
    minHeight: "56px",
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  description: {
    color: tokens.colorNeutralForeground3,
  },
  // The theme's pills hold a 16px icon each.
  themeTab: {
    display: "flex",
    padding: "5px 7px",
    fontSize: "16px",
  },
  hidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
  // The design's width, where Fluent's Dropdown is 250px at least.
  glow: {
    minWidth: 0,
    width: "143px",
  },
  glowValue: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  // A glow's own colour, whichever is chosen (set in GlowName); a hairline
  // inside, so White and Neon still show on a light list.
  swatch: {
    flexShrink: 0,
    width: "12px",
    height: "12px",
    borderRadius: tokens.borderRadiusSmall,
    boxShadow: `inset 0 0 0 ${tokens.strokeWidthThin} ${tokens.colorNeutralStroke1}`,
  },
  cards: {
    display: "flex",
    gap: "10px",
  },
  // A preview over its name, shaded as a subtle button is: lightly on hover, a little more when chosen.
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    padding: "6px",
    borderRadius: tokens.borderRadiusLarge,
    cursor: "pointer",
    ":hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
    ":has(input:focus-visible)": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
    },
  },
  cardChecked: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    ":hover": {
      backgroundColor: tokens.colorSubtleBackgroundSelected,
    },
  },
  // The card's radio: there for the keyboard and screen readers, unseen.
  radio: {
    position: "absolute",
    width: 0,
    height: 0,
    margin: 0,
    opacity: 0,
    pointerEvents: "none",
  },
  preview: {
    width: "112px",
    height: "72px",
    borderRadius: "8px",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground3,
  },
  // A timeline preview: two rows of the board, a flight on each.
  rowLine: {
    stroke: tokens.colorNeutralStroke2,
    strokeWidth: 1,
  },
  bar: {
    fill: tokens.colorNeutralBackground1,
    stroke: tokens.colorNeutralStroke1,
    strokeWidth: 1,
  },
});

interface Choice<T extends string> {
  value: T;
  label: string;
  preview: ReactNode;
}

/** One setting's choices as a row of cards, native radios underneath, so arrow keys move between them. */
function ChoiceCards<T extends string>({
  name,
  label,
  choices,
  value,
  onChange,
}: {
  name: string;
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useStyles();
  return (
    <div role="radiogroup" aria-label={label} className={styles.cards}>
      {choices.map((choice) => (
        <label key={choice.value} className={mergeClasses(styles.card, choice.value === value && styles.cardChecked)}>
          <input
            type="radio"
            className={styles.radio}
            name={name}
            value={choice.value}
            checked={choice.value === value}
            onChange={() => onChange(choice.value)}
          />
          {choice.preview}
          <Caption1>{choice.label}</Caption1>
        </label>
      ))}
    </div>
  );
}

/** A preview's bars are 18px high, rounded as the board's are at theirs. */
const PREVIEW_BAR = 18;
const PREVIEW_RADIUS = (BAR_RADIUS * PREVIEW_BAR) / (ROW_HEIGHT - 2 * BAR_INSET);
const PREVIEW_BARS: BarBox[] = [
  { x: 10.5, y: 9.5, width: 62, height: PREVIEW_BAR },
  { x: 39.5, y: 44.5, width: 62, height: PREVIEW_BAR },
];

function TimelinePreview({ style }: { style: FlightStyle }) {
  const styles = useStyles();
  const ends = { start: END_SHAPE[style].flight, end: END_SHAPE[style].flight };
  return (
    <div className={styles.preview}>
      <svg width={112} height={72} aria-hidden>
        <path d="M0 36.5H112" className={styles.rowLine} />
        {PREVIEW_BARS.map((box) => (
          <path key={box.y} d={barPath(box, ends, PREVIEW_RADIUS)} className={styles.bar} />
        ))}
      </svg>
    </div>
  );
}

// Aero, the default, first.
const TIMELINE_CHOICES: Choice<FlightStyle>[] = (["aero", "classic"] as const).map((value) => ({
  value,
  label: FLIGHT_STYLE_LABEL[value],
  preview: <TimelinePreview style={value} />,
}));

/** A glow's name after a square of its colour. */
function GlowName({ glow, label }: { glow: SkyeGlow; label: string }) {
  const styles = useStyles();
  const light = GLOW_THEMES[glow].light[useColorMode()];
  return (
    <span className={styles.glowValue}>
      <span className={styles.swatch} style={{ backgroundColor: `rgb(${light})` }} aria-hidden />
      {label}
    </span>
  );
}

type Theme = "system" | "light" | "dark";

/** The themes, in the pills' order, each named on its row while chosen. */
const THEMES: readonly { value: Theme; label: string; icon: FluentIcon }[] = [
  { value: "system", label: "System", icon: Desktop },
  { value: "light", label: "Light", icon: WeatherSunny },
  { value: "dark", label: "Dark", icon: WeatherMoon },
];

export function AppearanceSettings() {
  const styles = useStyles();
  const { flightStyle, setFlightStyle } = useOperations();
  const [theme, setTheme] = useState<Theme>("system");
  const skyeGlow = useSkyeGlow();
  const glowLabel = SKYE_GLOWS.find((g) => g.value === skyeGlow)?.label ?? "";
  const [glowOpen, setGlowOpen] = useState(false);
  const tethers = useSkyeTethers();
  const tethersId = useId();
  const grain = useGrain();
  const glowId = useId();
  const noiseId = useId();
  const reduceEffects = useReduceEffects();
  const reduceId = useId();
  // Escape closes Glow's list, not the whole overlay (Coral's Overlay listens on the document).
  const keepEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && glowOpen) event.stopPropagation();
  };
  return (
    <div className={styles.root}>
      <Label size="large" weight="semibold">
        Appearance
      </Label>
      <div className={styles.list}>
        <div className={styles.timeline}>
          <Label>Timeline</Label>
          <ChoiceCards
            name="timeline"
            label="Timeline"
            choices={TIMELINE_CHOICES}
            value={flightStyle}
            onChange={setFlightStyle}
          />
        </div>

        <div className={styles.row}>
          <Label>{THEMES.find((t) => t.value === theme)?.label}</Label>
          <div role="group" aria-label="Theme">
            <PillTabList selectedValue={theme} onTabSelect={(_, data) => setTheme(data.value as Theme)}>
              {THEMES.map(({ value, label, icon: Icon }) => (
                <PillTab key={value} value={value} className={styles.themeTab}>
                  <Icon filled={value === theme} />
                  <span className={styles.hidden}>{label}</span>
                </PillTab>
              ))}
            </PillTabList>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <Label id={glowId}>Glow</Label>
            <Caption1 className={styles.description}>Skye's orb and the app's colors</Caption1>
          </div>
          {/* Inline, so its list sits inside the overlay rather than under its backdrop. */}
          <Dropdown
            appearance="filled-darker"
            inlinePopup
            className={styles.glow}
            aria-labelledby={glowId}
            value={glowLabel}
            button={{ children: <GlowName glow={skyeGlow} label={glowLabel} /> }}
            selectedOptions={[skyeGlow]}
            onOptionSelect={(_, data) => data.optionValue && setSkyeGlow(data.optionValue as SkyeGlow)}
            onOpenChange={(_, data) => setGlowOpen(data.open)}
            onKeyDown={keepEscape}
          >
            {SKYE_GLOWS.map(({ value, label }) => (
              <Option key={value} value={value} text={label}>
                <GlowName glow={value} label={label} />
              </Option>
            ))}
          </Dropdown>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <Label htmlFor={tethersId}>Tethers</Label>
            <Caption1 className={styles.description}>Lines from Skye to her echoes</Caption1>
          </div>
          <Switch id={tethersId} checked={tethers} onChange={(_, data) => setSkyeTethers(data.checked)} />
        </div>

        <div className={styles.row}>
          <Label htmlFor={noiseId}>Noise</Label>
          {/* Reduced effects have no grain, whatever this says. */}
          <Switch
            id={noiseId}
            checked={grain}
            disabled={reduceEffects}
            onChange={(_, data) => setGrain(data.checked)}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <Label htmlFor={reduceId}>Reduce effects</Label>
            <Caption1 className={styles.description}>Still background and orb; no blur or grain</Caption1>
          </div>
          <Switch id={reduceId} checked={reduceEffects} onChange={(_, data) => setReduceEffects(data.checked)} />
        </div>
      </div>
    </div>
  );
}
