import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface AskWaveformProps {
  /** Recent input levels from 0 to 1, oldest first. Without levels the bars breathe gently to show the call is live. */
  levels?: readonly number[];
  /** Fixed number of bars. Omit to fill the available width. */
  bars?: number;
}

/** Bar geometry, in pixels; askSkye.css reads these back as custom properties. */
const BAR_WIDTH = 2.5;
const BAR_GAP = 3;
const FALLBACK_BARS = 28;

/** Levels resampled to `count` bars, interpolating between samples so a wide visualizer stays smooth. */
function resample(levels: readonly number[], count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const position = count > 1 ? (index / (count - 1)) * (levels.length - 1) : 0;
    const low = Math.floor(position);
    const high = Math.min(levels.length - 1, low + 1);
    const blend = position - low;
    const value = (levels[low] ?? 0) * (1 - blend) + (levels[high] ?? 0) * blend;
    return Math.min(1, Math.max(0, value));
  });
}

/**
 * VelmAI's voice visualizer: bars that grow from the center line, with the
 * newest level on the right. The bar count follows the width it is given.
 * Purely decorative; the call state is announced by the bar's controls.
 */
export function AskWaveform({ levels, bars }: AskWaveformProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element || bars !== undefined) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [bars]);

  const fitted = Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP));
  const count = bars ?? (width > 0 ? Math.max(1, fitted) : FALLBACK_BARS);
  const live = !!levels && levels.length > 0;
  const heights = live ? resample(levels, count) : Array.from({ length: count }, () => 0);

  return (
    <span
      ref={ref}
      className="ask-waveform"
      data-live={live}
      style={{ "--ask-bar-width": `${BAR_WIDTH}px`, "--ask-bar-gap": `${BAR_GAP}px` } as CSSProperties}
      aria-hidden
    >
      {heights.map((height, index) => (
        <span
          key={index}
          className="ask-waveform__bar"
          style={{ "--ask-bar-level": height, "--ask-bar-index": index } as CSSProperties}
        />
      ))}
    </span>
  );
}
