// A few rows of the board over a stretch of its day, drawn as the board draws
// them (its stand column, ruler, grid, bars, labels and delay ghosts, in its
// theme), but only to look at: e.g. the conflict in Skye's notification of
// it (DisruptionNotice). It fits its width, so it never scrolls, and nothing
// in it can be focused, pointed at or selected; `ariaLabel` says what it shows.
import { useMemo } from "react";
import {
  BarGhosts,
  BarLabels,
  OccupancyBars,
  StandRows,
  StandTimeline,
  TimeAxis,
  TimeGrid,
  type Millis,
  type Occupancy,
  type TimelineRow,
} from "../stand-timeline";
import { DEMO_DATA as DATA } from "./demoData";
import { ghostClashes } from "./delays";
import { BAR_ENDS, LABEL_PRIORITY } from "./StandTimelineDemo";
import {
  BAR_INSET,
  BAR_RADIUS,
  DemoPatternDefs,
  GUTTER_WIDTH,
  LABEL_METRICS,
  LABEL_PADDING,
  QUARTER_RULER,
  ROW_HEIGHT,
  fluentChartTheme,
  makeDemoAccessors,
  type FlightStyle,
} from "./theme";
import type { Pixels } from "../studio/drawings";
import "./demo.css";

export interface BoardSnippetProps {
  /** The stands to show, in the board's order. */
  rows: readonly TimelineRow[];
  /** The stretch of the day to show [start, end), epoch ms. */
  domain: readonly [Millis, Millis];
  /** The board's stays, as it has them now (a new array per stand change); those on other rows are left out. */
  occupancies: readonly Occupancy[];
  flightStyle?: FlightStyle;
  drawings?: ReadonlyMap<string, Pixels>;
  /** What it shows, for screen readers: to them it is one picture. */
  ariaLabel: string;
}

export function BoardSnippet({ rows, domain, occupancies, flightStyle = "aero", drawings, ariaLabel }: BoardSnippetProps) {
  const accessors = useMemo(
    () =>
      makeDemoAccessors(
        DATA.turnsById,
        DATA.stayPosition,
        DATA.endpoints,
        DATA.delays,
        ghostClashes(occupancies, DATA.delays),
        undefined,
        false,
        undefined,
        undefined,
        drawings,
      ),
    [occupancies, drawings],
  );
  return (
    <div className="board-snippet" role="img" aria-label={ariaLabel}>
      <div inert>
        <StandTimeline
          style={fluentChartTheme}
          className="demo-chart"
          rows={rows}
          visits={DATA.visits}
          occupancies={occupancies}
          domain={domain}
          timeZone="UTC"
          rowHeight={ROW_HEIGHT}
          barInset={BAR_INSET}
          barRadius={BAR_RADIUS}
          barEnds={BAR_ENDS[flightStyle]}
          labelWidth={GUTTER_WIDTH}
          minHourWidth={0}
          ariaLabel={ariaLabel}
        >
          <DemoPatternDefs />
          <StandRows zebra={false} title={null} showGroup={false} labelAlign="end" />
          <TimeGrid minorMs={QUARTER_RULER.stepMs} />
          <OccupancyBars barStyle={accessors.barStyle} renderBar={accessors.renderBar} describe={accessors.describe} />
          <BarLabels
            slots={accessors.labelSlots}
            color={accessors.labelColor}
            className={accessors.labelClassName}
            priority={LABEL_PRIORITY}
            padding={LABEL_PADDING[flightStyle]}
            {...LABEL_METRICS}
          />
          <BarGhosts ghosts={accessors.ghosts} />
          <TimeAxis position="top" zoneLabel="UTC" {...QUARTER_RULER} />
        </StandTimeline>
      </div>
    </div>
  );
}
