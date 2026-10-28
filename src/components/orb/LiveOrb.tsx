import * as React from "react";
import { makeStyles, mergeClasses, Skeleton, SkeletonItem } from "@fluentui/react-components";
import { createOrbRenderer } from "./engine/orb-renderer";
import {
  createPresetOrbStateConfiguration,
  defaultOrbActivationDuration,
  defaultOrbTransitionDuration,
  resolveOrbStateParams,
  type OrbRenderTarget,
  type OrbStateName,
} from "./engine/orb-states";
import type { OrbParams, StyleName } from "./engine/presets";
import type { OrbPalette } from "./palettes";
import { useVoiceLevel } from "./useVoiceLevel";
import { useAtRest, useReduceEffects } from "../effects";

export type OrbPreset = StyleName;
export type OrbState = OrbStateName;

export type LiveOrbProps = {
  /** Diameter of the orb's box in px. The canvas overhangs it so the glow is not clipped. */
  size?: number;
  /** Upstream preset name; see engine/presets.ts for the full list. */
  preset?: OrbPreset;
  /** "thinking" is the active, faster look; "idle" is the calm one. Changes animate. */
  state?: OrbState;
  /** Colour overrides on top of the preset; also tints the static fallback. */
  palette?: OrbPalette;
  /** Faint halo in the orb's own colours that slowly turns and breathes. */
  glow?: boolean;
  /** Audio to react to, e.g. the caller's microphone: speech speeds the orb up and swells its glow. */
  voice?: MediaStream | null;
  /** Stops the renderer (e.g. while hidden); the placeholder shows in its place. */
  paused?: boolean;
  /**
   * What shows while the renderer starts or is paused: a skeleton (the
   * default), or the static orb, for one that must never look empty (or that
   * sits outside Fluent's theme, where a skeleton has no colours).
   */
  placeholder?: "skeleton" | "gradient";
  /**
   * A still of this orb (a PNG of its canvas; see skyeOrbStill), shown as the
   * static orb in place of the gradient: as the placeholder, and when it
   * cannot run live (no WebGPU, reduced motion).
   */
  still?: string;
  className?: string;
};

/** How far the canvas extends past `size`, matching the overhang of the orb image in Figma. */
const CANVAS_OVERSCAN = 1.25;

/** At full voice the orb runs this much faster than its state's speed. */
const VOICE_SPEEDUP = 1.5;
/** Glow strength at rest and the extra a full voice adds; see `glowVoice`. */
const GLOW_OPACITY = 0.4;
const GLOW_VOICE_OPACITY = 0.5;
/** How far the glow grows past its resting size at full voice. */
const GLOW_VOICE_SCALE = 0.2;

const useStyles = makeStyles({
  root: {
    position: "relative",
    display: "inline-block",
    flexShrink: 0,
    borderRadius: "50%",
    isolation: "isolate",
  },
  fallback: {
    position: "absolute",
    zIndex: 1,
    inset: 0,
    borderRadius: "50%",
    transitionProperty: "opacity",
    transitionDuration: "200ms",
  },
  // A still of the orb, drawn as the canvas is, under it.
  still: {
    position: "absolute",
    zIndex: 1,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
    transitionProperty: "opacity",
    transitionDuration: "200ms",
  },
  canvas: {
    position: "absolute",
    zIndex: 2,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
    transitionProperty: "opacity",
    transitionDuration: "200ms",
  },
  hidden: {
    opacity: 0,
  },
  // Stands in for the orb while the renderer is starting or paused. It snaps
  // in (so the circle is never empty) and fades out under the arriving orb.
  skeleton: {
    position: "absolute",
    zIndex: 1,
    inset: 0,
    display: "flex",
  },
  skeletonHidden: {
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "200ms",
  },
  // Holds the glow so it can fade in with the orb; the glow itself animates
  // its own opacity, which a class on it could not override.
  glowLayer: {
    position: "absolute",
    zIndex: 0,
    inset: 0,
    transitionProperty: "opacity",
    transitionDuration: "200ms",
  },
  // Leaves at once with the orb, so it never rings an empty circle.
  glowHidden: {
    opacity: 0,
    transitionDuration: "0s",
  },
  // Scales the halo's strength and size with the voice, set per frame in
  // inline style. Its resting opacity times the glow's breath (0.5 to 1)
  // gives the halo's own 0.2 to 0.4.
  glowVoice: {
    position: "absolute",
    inset: 0,
    opacity: GLOW_OPACITY,
  },
  // Edge-only halo: a transparent circle the size of the orb whose outer
  // shadows paint past its rim (outer shadows never draw inside the box), so
  // nothing tints the orb itself. Kept faint on purpose; the rotation swings
  // the two side colours around the orb, the breath sets its strength.
  glow: {
    position: "absolute",
    borderRadius: "50%",
    opacity: 0.75,
    pointerEvents: "none",
    animationName: [
      { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
      { from: { opacity: 0.5 }, to: { opacity: 1 } },
    ],
    animationDuration: "14s, 4s",
    animationTimingFunction: "linear, ease-in-out",
    animationDirection: "normal, alternate",
    animationIterationCount: "infinite",
    "@media (prefers-reduced-motion: reduce)": {
      animationName: "none",
    },
  },
  // Effects reduced, the halo holds still too.
  glowStill: {
    animationName: "none",
  },
});

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = React.useState(() => window.matchMedia(query).matches);
  React.useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Static stand-in drawn from the orb's own colours: a highlight over a body that fades to the background. */
function fallbackBackground(params: OrbParams): string {
  return (
    `radial-gradient(circle at 34% 28%, ${params.highlightColor}8C, transparent 38%),` +
    `radial-gradient(circle at 50% 58%, ${params.colorB} 0%, ${params.colorD} 42%, ${params.canvasColor} 78%)`
  );
}

/**
 * Halo colours: a neutral highlight glow under two flash colours pushed to
 * opposite sides, the classic glowing-orb layering. Offsets and blurs scale
 * with the orb so it reads the same at any size.
 */
function glowShadow(params: OrbParams, size: number): string {
  const px = (fraction: number) => `${Math.round(size * fraction * 10) / 10}px`;
  return [
    `0 0 ${px(0.17)} ${params.highlightColor}`,
    `${px(-0.035)} 0 ${px(0.27)} ${params.colorC}`,
    `${px(0.035)} 0 ${px(0.27)} ${params.colorB}`,
  ].join(", ");
}

/**
 * Animated WebGPU orb. Shows a static gradient until the first frame lands,
 * and keeps it when WebGPU is unavailable, the user prefers reduced motion or
 * effects are reduced (components/effects). While the app is at rest the
 * renderer stops and the static orb stands in, until any input wakes it.
 * Decorative: pair it with visible text that carries any meaning.
 */
export function LiveOrb({
  size = 32,
  preset = "siri",
  state = "idle",
  palette,
  glow = false,
  voice,
  paused = false,
  placeholder = "skeleton",
  still,
  className,
}: LiveOrbProps) {
  const styles = useStyles();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  // Effects reduced, the orb holds still, as under reduced motion.
  const reduceEffects = useReduceEffects();
  const reducedMotion = prefersReducedMotion || reduceEffects;
  const atRest = useAtRest();
  const [status, setStatus] = React.useState<"loading" | "ready" | "failed">("loading");
  // Once it has rested, the static orb stands in while it starts again, not the skeleton.
  const [rested, setRested] = React.useState(false);
  React.useEffect(() => {
    if (atRest) setRested(true);
  }, [atRest]);

  const configuration = React.useMemo(() => createPresetOrbStateConfiguration(preset), [preset]);

  // The renderer pulls the target every frame, so preset and state changes
  // apply (and state changes animate) without restarting it.
  const params: OrbParams = {
    ...resolveOrbStateParams(configuration, state),
    ...palette?.shared,
    ...palette?.states?.[state],
  };
  const targetRef = React.useRef<OrbRenderTarget | null>(null);
  targetRef.current = {
    state,
    params,
    activationDuration: defaultOrbActivationDuration,
    transitionDuration: defaultOrbTransitionDuration,
  };

  // Can run live at all (WebGPU works, motion allowed); `live` = running now.
  const canRunLive = !reducedMotion && status !== "failed";
  const live = canRunLive && !paused && !atRest;

  // Voice drives motion, so it stays still under reduced motion and while paused or at rest.
  const glowVoiceRef = React.useRef<HTMLSpanElement>(null);
  const voiceLevel = useVoiceLevel(reducedMotion || paused || atRest ? null : voice, (level) => {
    const element = glowVoiceRef.current;
    if (!element) return;
    element.style.opacity = level ? String(GLOW_OPACITY + GLOW_VOICE_OPACITY * level) : "";
    element.style.transform = level ? `scale(${1 + GLOW_VOICE_SCALE * level})` : "";
  });

  // A restarted renderer must fade in again once its first frame lands.
  React.useEffect(() => {
    if (!live) setStatus((current) => (current === "ready" ? "loading" : current));
  }, [live]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!live || !canvas) return undefined;

    return createOrbRenderer({
      canvas,
      // Speech speeds the orb up. The renderer integrates speed into its
      // motion phase, so the change never jumps the animation.
      getTarget: () => {
        const target = targetRef.current!;
        const speedup = 1 + VOICE_SPEEDUP * voiceLevel.current;
        if (speedup === 1) return target;
        return { ...target, params: { ...target.params, speed: target.params.speed * speedup } };
      },
      onReady: () => {
        setStatus("ready");
        setRested(false);
      },
      onError: (error) => {
        console.warn("LiveOrb: falling back to a static orb.", error);
        setStatus("failed");
      },
    });
  }, [live, voiceLevel]);

  const showCanvas = live && status === "ready";
  // Starting up or paused: the skeleton only, no glow. The static gradient
  // (with glow) is for when the orb cannot run live at all, or for a caller
  // that asked for it as the placeholder; and at rest, and waking from it.
  const waiting = canRunLive && !showCanvas;
  const resting = atRest || rested;
  const skeleton = waiting && !resting && placeholder === "skeleton";
  const gradient = !canRunLive || (waiting && (resting || placeholder === "gradient"));
  const canvasSize = Math.round(size * CANVAS_OVERSCAN);
  // The shader draws the ball at `radius` of the canvas, a bit inside `size`.
  // Tuck the glow circle 1px under that rim so no dark seam shows between them.
  const glowInset = (size - params.radius * canvasSize) / 2 + 1;

  return (
    <span className={mergeClasses(styles.root, className)} style={{ width: size, height: size }} aria-hidden>
      {glow && (
        <span className={mergeClasses(styles.glowLayer, skeleton && styles.glowHidden)}>
          <span ref={glowVoiceRef} className={styles.glowVoice}>
            <span
              className={mergeClasses(styles.glow, reduceEffects && styles.glowStill)}
              style={{ inset: glowInset, boxShadow: glowShadow(params, size) }}
            />
          </span>
        </span>
      )}
      {still ? (
        <img
          src={still}
          alt=""
          className={mergeClasses(styles.still, !gradient && styles.hidden)}
          style={{ width: canvasSize, height: canvasSize }}
        />
      ) : (
        <span
          className={mergeClasses(styles.fallback, !gradient && styles.hidden)}
          style={{ background: fallbackBackground(params) }}
        />
      )}
      {placeholder === "skeleton" && (
        <Skeleton className={mergeClasses(styles.skeleton, !skeleton && styles.skeletonHidden)}>
          {/* SkeletonItem only takes preset sizes; the inline size matches any orb. */}
          <SkeletonItem shape="circle" size={40} style={{ width: size, height: size }} />
        </Skeleton>
      )}
      {live && (
        <canvas
          ref={canvasRef}
          className={mergeClasses(styles.canvas, !showCanvas && styles.hidden)}
          style={{ width: canvasSize, height: canvasSize }}
        />
      )}
    </span>
  );
}
