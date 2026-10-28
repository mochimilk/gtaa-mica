import { useEffect, useRef } from "react";
import { useAtRest, useReduceEffects } from "../effects";
import { useOpsSelections } from "../../operations/OperationsContext";
import "./skyeGlow.css";

/** The gradients Skye's selections are drawn with on SVG; skyeGlow.css names them too. */
const SKYE_GLOW_GRADIENT_ID = "skye-glow-gradient";
const SKYE_GLOW_FLOW_ID = "skye-glow-flow";

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The orb's colours as SVG gradients, for drawing what Skye has selected on
 * the chart (see skyeGlow.css): one that slowly turns, for a bar's outline,
 * and one that flows across the chart, for the line linking two bars. Mount
 * it once; any SVG in the page can use them. They move only while Skye has
 * something selected and the app is awake (components/effects), since a
 * running SVG animation draws a frame every frame, used or not; with effects
 * reduced, they hold still.
 */
export function SkyeGlowDefs() {
  const reduceEffects = useReduceEffects();
  const animate = !reducedMotion() && !reduceEffects;
  const { skyeSelection } = useOpsSelections();
  const atRest = useAtRest();
  const running = animate && !atRest && (skyeSelection.occupancyIds.length > 0 || skyeSelection.flightId !== null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !animate) return;
    if (running) svg.unpauseAnimations();
    else svg.pauseAnimations();
  }, [animate, running]);
  return (
    <svg ref={svgRef} className="skye-glow-defs" width="0" height="0" aria-hidden focusable="false">
      <defs>
        <linearGradient id={SKYE_GLOW_GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0F6FFF" />
          <stop offset="0.35" stopColor="#7A5CFF" />
          <stop offset="0.65" stopColor="#14B8E0" />
          <stop offset="1" stopColor="#0F6FFF" />
          {animate && (
            <animateTransform
              attributeName="gradientTransform"
              type="rotate"
              values="0 0.5 0.5; 360 0.5 0.5"
              dur="3s"
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
        {/*
          In the chart's own units rather than each shape's box: a straight
          link has no width or no height, and a box gradient would not paint
          it at all. The bands repeat every 120px and drift along it.
        */}
        <linearGradient
          id={SKYE_GLOW_FLOW_ID}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="120"
          y2="120"
          spreadMethod="repeat"
        >
          <stop offset="0" stopColor="#0F6FFF" />
          <stop offset="0.35" stopColor="#7A5CFF" />
          <stop offset="0.65" stopColor="#14B8E0" />
          <stop offset="1" stopColor="#0F6FFF" />
          {animate && (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              values="0 0; 120 120"
              dur="2.4s"
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
    </svg>
  );
}
