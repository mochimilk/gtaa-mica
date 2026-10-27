// The board's zoom as one row of a menu (the header's View menu): how far the
// board is zoomed, zoom out and in, and fit the whole window. It is not a menu
// item, so using it leaves the menu open. Greyscale, like the menu around it
// (demo.css). The board zooms the same zoom when the user pinches a trackpad
// (or Ctrl + scrolls) over it (StandTimeline's `zoom`); only time stretches or
// shrinks.
import { useId, type KeyboardEvent } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { AddRegular, ScaleFitRegular, SubtractRegular, ZoomInRegular } from "@fluentui/react-icons";
import { useTimelineZoom, type TimelineZoom } from "../stand-timeline";
import { DEMO_DOMAIN, formatUtc } from "./demoData";
import { MAX_HOUR_WIDTH, MIN_HOUR_WIDTH } from "./theme";
import "./demo.css";

const WINDOW_LABEL = `${formatUtc(DEMO_DOMAIN[0])}–${formatUtc(DEMO_DOMAIN[1])} UTC`;

/** The board's zoom, starting at its readable default density, which reads as 100%. */
export const useDemoZoom = () =>
  useTimelineZoom({ initialHourWidth: MIN_HOUR_WIDTH, maxHourWidth: MAX_HOUR_WIDTH });

/**
 * Where the zoom buttons stop, in percent, as a browser's do. Past the last,
 * zooming in goes to the most the board allows; below the fit, out fits it.
 */
const LEVELS = [50, 67, 75, 100, 125, 150, 200, 300, 400, 500];

const percentOf = (hourWidth: number) => (hourWidth / MIN_HOUR_WIDTH) * 100;

/** The next stop past the zoom shown, in pixels per hour. */
function nextLevel(hourWidth: number, direction: 1 | -1): number {
  const shown = Math.round(percentOf(hourWidth));
  const level =
    direction > 0 ? LEVELS.find((l) => l > shown) : LEVELS.filter((l) => l < shown).at(-1);
  return level === undefined ? (direction > 0 ? Infinity : 0) : (level / 100) * MIN_HOUR_WIDTH;
}

/**
 * Left and right move across the row's buttons. Up and down are the menu's:
 * they move through its items and these buttons alike.
 */
function moveAcross(event: KeyboardEvent<HTMLDivElement>) {
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  const next = buttons[buttons.indexOf(event.target as HTMLButtonElement) + step];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

export function ZoomMenuRow({ zoom }: { zoom: TimelineZoom }) {
  const labelId = useId();
  const ready = zoom.fitHourWidth > 0;
  const canZoomIn = ready && zoom.hourWidth < zoom.maxHourWidth;
  const canZoomOut = ready && !zoom.fitted;
  return (
    <div className="demo-zoom-row" role="group" aria-labelledby={labelId} onKeyDown={moveAcross}>
      <ZoomInRegular className="demo-zoom-row-icon" />
      <span className="demo-zoom-row-label" id={labelId}>
        Zoom
      </span>
      <Tooltip content="Zoom out" relationship="label">
        <Button
          size="small"
          appearance="subtle"
          icon={<SubtractRegular />}
          disabledFocusable={!canZoomOut}
          onClick={() => zoom.zoomTo(nextLevel(zoom.hourWidth, -1))}
        />
      </Tooltip>
      <span className="demo-zoom-row-level" aria-live="polite">
        {ready ? `${Math.round(percentOf(zoom.hourWidth))}%` : ""}
      </span>
      <Tooltip content="Zoom in" relationship="label">
        <Button
          size="small"
          appearance="subtle"
          icon={<AddRegular />}
          disabledFocusable={!canZoomIn}
          onClick={() => zoom.zoomTo(nextLevel(zoom.hourWidth, 1))}
        />
      </Tooltip>
      <Tooltip content={`Fit the whole window, ${WINDOW_LABEL}`} relationship="label">
        <Button
          size="small"
          appearance="subtle"
          icon={<ScaleFitRegular />}
          disabledFocusable={!canZoomOut}
          onClick={zoom.fit}
        />
      </Tooltip>
    </div>
  );
}
