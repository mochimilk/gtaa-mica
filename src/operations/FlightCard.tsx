// The selection popover's cards, from the GTAA-Dash designs.
// - FlightCard (Figma node 144:3130), for one flight or one chart stay: its
//   arrival (left) and departure (right), as on its bar and in a box drawn in
//   the board's flight style, with its aircraft maker's emblem centred between
//   them; then its stand, aircraft and registration, each under a caption (a
//   dash where one isn't known); then its actions. Swap
//   needs two stays, so here it is only ever disabled; Unassign takes the stay
//   off its stand, and a flight waiting for a stand gets Assign stand in its
//   place. Reset stands shows once anything has changed.
// - SwapCard (Figma node 147:3637), for two chart stays: each one's flights
//   and details, mirrored about Swap, which asks to swap their stands (see
//   SwapConfirm).
// Three or more stays selected get FlightActions instead.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Divider, Tag, Tooltip } from "@fluentui/react-components";
import {
  ArrowCircleLeft20Regular,
  ArrowCircleRight20Regular,
  ArrowReset20Regular,
  ArrowSwap20Regular,
  CalendarAdd20Regular,
  CalendarCancel20Regular,
  VehicleTruckProfile20Regular,
} from "@fluentui/react-icons";
import { barEndDepth, barPath, type BarEnds, type Millis, type Occupancy } from "../stand-timeline";
import { AIRPORT_NAMES } from "../stand-timeline-demo/airports";
import { DEMO_DATA, formatUtc, formatUtcFull, formatUtcWithDay } from "../stand-timeline-demo/demoData";
import { MakerEmblem, emblemOf } from "../stand-timeline-demo/emblems";
import { AIRCRAFT_MAKER } from "../stand-timeline-demo/syntheticFixture";
import { BAR_RADIUS, END_SHAPE } from "../stand-timeline-demo/theme";
import {
  aircraftSize,
  checkSwap,
  flightsAtStay,
  hasStandChanges,
  occupancyById,
  offBoardStay,
  planAssign,
  standArea,
} from "./allocation";
import { selectedFlight, useOperations, type OpsSelection } from "./OperationsContext";
import type { OpsFlight } from "./operationsData";

type Side = "start" | "end";

/** What starts or ends the stay, as its bar shows it. */
interface CardEnd {
  kind: "flight" | "tow";
  /** The flight, or "Tow-in" / "Tow-out". */
  primary: string;
  /** A flight's route endpoint, or the stand a tow comes from or goes to. */
  code: string;
  /** Expected (UTC): a flight's estimate, or when the tow reaches or leaves the stand. */
  time: Millis;
}

/**
 * The stay the card is about: the one selected on the chart, or the selected
 * flight's, on its stand or waiting in the No stand lane. `onStand` is false
 * for a waiting one. A flight with no stay times has none.
 */
function cardStay(selection: OpsSelection, flight: OpsFlight | undefined) {
  if (!flight) return { stay: occupancyById(selection.occupancyIds[0]), onStand: true };
  if (flight.occupancyId) return { stay: occupancyById(flight.occupancyId), onStand: true };
  return { stay: flight.unplacedStay && offBoardStay(flight.unplacedStay.stayId), onStand: false };
}

function cardEnd(side: Side, stay: Occupancy | undefined, flight: OpsFlight | undefined): CardEnd | undefined {
  const start = side === "start";
  if (!stay) {
    // No stay times: only the flight's own end, at its estimate.
    if (!flight || (flight.direction === "arrival") !== start) return undefined;
    return { kind: "flight", primary: flight.flight, code: flight.routeEnd, time: flight.estimate };
  }
  const e = DEMO_DATA.endpoints.get(stay.id)?.[side];
  if (e?.kind === "flight") {
    const at = flightsAtStay(stay.id).find((f) => f.direction === (start ? "arrival" : "departure"));
    return {
      kind: "flight",
      primary: e.flight,
      code: "origin" in e ? e.origin : e.destination,
      time: at?.estimate ?? (start ? stay.start : stay.end),
    };
  }
  if (e?.kind === "tow") {
    // A tow comes from the visit's previous stand, or goes to its next one.
    const visit = DEMO_DATA.occupancies.filter((o) => o.visitId === stay.visitId).sort((a, b) => a.start - b.start);
    const at = visit.findIndex((o) => o.id === stay.id);
    return {
      kind: "tow",
      primary: start ? "Tow-in" : "Tow-out",
      code: visit[start ? at - 1 : at + 1]?.rowId ?? "",
      time: start ? stay.start : stay.end,
    };
  }
  return undefined;
}

export function FlightCard({ titleId, title }: { titleId: string; title: string }) {
  const { selection, assignStands, unassignStands, resetStands } = useOperations();
  const flight = selectedFlight(selection);
  const { stay, onStand } = cardStay(selection, flight);

  // A stay with no flight at it could not be given a stand again by flight, so it stays put.
  const unassignable = stay && onStand && flightsAtStay(stay.id).length > 0 ? stay : undefined;
  // A flight with no stand: where Assign stand would put it, or why it can't.
  const waiting = flight && !flight.standId ? flight : undefined;
  const assignPlan = waiting?.unplacedStay ? planAssign([waiting.unplacedStay.stayId]) : null;
  const assign = assignPlan?.assigns[0];
  const assignNote =
    assign && waiting?.unplacedStay
      ? `Assign stand puts it on ${assign.standId}, the first free stand that takes it, ` +
        `${formatUtc(waiting.unplacedStay.start)}–${formatUtc(waiting.unplacedStay.end)} UTC. ` +
        "Checked only for overlaps, stand sizes and closures."
      : (assignPlan?.unplaceable[0]?.reason ??
        "This flight has no stay times in the demo data, so it cannot be placed on a stand.");

  return (
    <div className="ops-card">
      <h2 id={titleId} className="ops-visually-hidden">
        {title}
      </h2>
      <div className="ops-card-head">
        <StayEnds stay={stay} flight={flight} />
      </div>
      <StayFacts stay={stay} onStand={onStand} flight={flight} />
      <Divider className="ops-card-divider" appearance="subtle" />
      <div className="ops-card-actions">
        <Tooltip content="Select two stays to swap their stands" relationship="description">
          <Button appearance="subtle" icon={<ArrowSwap20Regular />} aria-label="Swap stands" disabledFocusable data-ops-swap="" />
        </Tooltip>
        <div className="ops-card-actions-end">
          {hasStandChanges() && (
            <Tooltip content="Reset stands" relationship="label">
              <Button appearance="subtle" icon={<ArrowReset20Regular />} data-ops-reset-stands="" onClick={resetStands} />
            </Tooltip>
          )}
          {waiting ? (
            <Tooltip content={assignNote} relationship="description">
              <Button
                appearance="subtle"
                icon={<CalendarAdd20Regular />}
                aria-label="Assign stand"
                disabledFocusable={!assign}
                data-ops-assign=""
                onClick={() => assign && assignStands([assign])}
              />
            </Tooltip>
          ) : (
            <Tooltip content="Unassign stand" relationship="label">
              <Button
                appearance="subtle"
                icon={<CalendarCancel20Regular />}
                disabledFocusable={!unassignable}
                data-ops-unassign=""
                onClick={() => unassignable && unassignStands([unassignable.id])}
              />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

const rowIndex = new Map(DEMO_DATA.rows.map((row, index) => [row.id, index]));

/**
 * Two selected chart stays, in chart order (the upper stand on top), mirrored
 * about Swap. One dashed line runs from the one's box to the other's behind
 * the button, flowing down like the chart's own line between the two.
 */
export function SwapCard({
  titleId,
  title,
  pair,
}: {
  titleId: string;
  title: string;
  pair: readonly [Occupancy, Occupancy];
}) {
  const { requestSwap } = useOperations();
  const [upper, lower] = [...pair].sort(
    (a, b) => (rowIndex.get(a.rowId) ?? 0) - (rowIndex.get(b.rowId) ?? 0) || a.start - b.start,
  );
  const swap = checkSwap(pair[0].id, pair[1].id);
  return (
    <div className="ops-card">
      <h2 id={titleId} className="ops-visually-hidden">
        {title}
      </h2>
      <StayFacts stay={upper} onStand placement="above" />
      <div className="ops-card-head ops-card-head--above">
        <StayEnds stay={upper} />
      </div>
      <div className="ops-card-swap">
        <Tooltip
          content={
            swap.ok ? "Checked against the sample rules only: no overlap, and the stand size fits the aircraft." : swap.reason
          }
          relationship="description"
        >
          <Button
            className="ops-card-swap-button"
            appearance="primary"
            icon={<ArrowSwap20Regular />}
            disabledFocusable={!swap.ok}
            data-ops-swap=""
            onClick={() => swap.ok && requestSwap(pair[0].id, pair[1].id)}
          >
            Swap
          </Button>
        </Tooltip>
      </div>
      <div className="ops-card-head ops-card-head--below">
        <StayEnds stay={lower} />
      </div>
      <StayFacts stay={lower} onStand placement="below" />
    </div>
  );
}

/** The aircraft type at the stay, else the flight's own; undefined when neither is recorded. */
const aircraftTypeOf = (stay?: Occupancy, flight?: OpsFlight) =>
  (stay?.visitId && DEMO_DATA.turnsById.get(stay.visitId)?.aircraftType) || flight?.aircraftType || undefined;

/**
 * The stay's arrival (left) and departure (right) in their outlined box, as on
 * its bar, with its aircraft maker's emblem centred between them. Drawn in the
 * board's flight style: aero's box is rounded, with the icons; classic's is
 * shaped as its bar is (ShapedEnds).
 */
function StayEnds({ stay, flight }: { stay?: Occupancy; flight?: OpsFlight }) {
  const { flightStyle } = useOperations();
  const emblem = emblemOf(aircraftTypeOf(stay, flight));
  const start = cardEnd("start", stay, flight);
  const end = cardEnd("end", stay, flight);
  const middle = emblem && <MakerEmblem emblem={emblem} className="ops-card-emblem" />;
  if (flightStyle === "classic") return <ShapedEnds start={start} end={end} middle={middle} />;
  return (
    <div className="ops-card-ends ops-card-ends--aero">
      <CardEndView side="start" end={start} icon />
      {middle}
      <CardEndView side="end" end={end} icon />
    </div>
  );
}

/**
 * Classic: the box drawn with the chart's own bar shape at its size, tapered
 * at a flight's end and zigzagged at a tow's, so its ends match the bar's at
 * any height. Its 1px line sits just inside the box, as a border would, and
 * each end's text keeps clear of where its shape begins.
 */
function ShapedEnds({ start, end, middle }: { start?: CardEnd; end?: CardEnd; middle: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const measure = () => setSize({ width: box.clientWidth, height: box.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const ends: BarEnds = { start: END_SHAPE[start?.kind ?? "none"], end: END_SHAPE[end?.kind ?? "none"] };
  return (
    <div ref={ref} className="ops-card-ends ops-card-ends--shaped">
      {size.width > 0 && (
        <svg className="ops-card-ends-outline" aria-hidden="true">
          <path d={barPath({ x: 0.5, y: 0.5, width: size.width - 1, height: size.height - 1 }, ends, BAR_RADIUS)} />
        </svg>
      )}
      <CardEndView side="start" end={start} inset={barEndDepth(ends.start, size.height)} />
      {middle}
      <CardEndView side="end" end={end} inset={barEndDepth(ends.end, size.height)} />
    </div>
  );
}

/**
 * The stay's stand, aircraft and registration, each under a caption. On the
 * swap card the upper stay's sit above its box and the lower's below.
 */
function StayFacts({
  stay,
  onStand,
  flight,
  placement,
}: {
  stay?: Occupancy;
  onStand: boolean;
  flight?: OpsFlight;
  placement?: "above" | "below";
}) {
  const turn = stay?.visitId ? DEMO_DATA.turnsById.get(stay.visitId) : undefined;
  const type = aircraftTypeOf(stay, flight);
  const size = type && stay ? aircraftSize(stay) : undefined;
  const registration = turn?.registration || flight?.registration;
  return (
    <div className={placement ? `ops-card-facts ops-card-facts--${placement}` : "ops-card-facts"}>
      {stay && onStand ? (
        <CardFact caption={standArea(stay.rowId) ?? "Stand"} srLabel="Stand">
          {stay.rowId}
        </CardFact>
      ) : (
        <CardFact caption="Stand">
          <Missing label="Not assigned" />
        </CardFact>
      )}
      <CardFact align="center" caption={(type && AIRCRAFT_MAKER[type]) || "Aircraft"}>
        {type ? <span className="ops-card-type">{type}</span> : <Missing label="Not recorded" />}
        {size && (
          <Tag className="ops-card-size" size="extra-small" appearance="filled" shape="rounded">
            <abbr title={size === "wide" ? "Widebody" : "Narrowbody"}>{size === "wide" ? "WB" : "NB"}</abbr>
          </Tag>
        )}
      </CardFact>
      <CardFact align="end" caption="Code">
        {registration || <Missing label="Not recorded" />}
      </CardFact>
    </div>
  );
}

/** A value that isn't there: a dash, which screen readers hear as `label`. */
function Missing({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true">-</span>
      <span className="ops-visually-hidden">{label}</span>
    </>
  );
}

/**
 * One end of the stay: the flight (or tow) over its route endpoint (or stand)
 * and time, with an icon beside it in aero. The end side is right-aligned, as
 * on the bar. An end with nothing recorded is left empty. `inset` keeps the
 * text that far further in from its side, clear of a shaped end.
 */
function CardEndView({ side, end, icon: withIcon = false, inset = 0 }: { side: Side; end?: CardEnd; icon?: boolean; inset?: number }) {
  const start = side === "start";
  if (!end) return <div className={`ops-card-end ops-card-end--${side}`} />;
  const icon = !withIcon ? null : end.kind === "tow" ? (
      <VehicleTruckProfile20Regular aria-hidden />
    ) : start ? (
      <ArrowCircleLeft20Regular aria-hidden />
    ) : (
      <ArrowCircleRight20Regular aria-hidden />
    );
  return (
    <div className={`ops-card-end ops-card-end--${side}`}>
      {start && icon}
      {/* Padding inside the end, not on it, so both ends stay equal and the emblem centred. */}
      <div className="ops-card-end-text" style={inset ? { [start ? "paddingInlineStart" : "paddingInlineEnd"]: inset } : undefined}>
        <div className="ops-card-flight">
          {end.kind === "flight" && <span className="ops-visually-hidden">{start ? "Arrival " : "Departure "}</span>}
          {end.primary}
        </div>
        <div className="ops-card-route">
          {end.code && (
            <>
              <span className="ops-card-code" title={AIRPORT_NAMES[end.code]}>
                {end.code}
              </span>{" "}
            </>
          )}
          <span title={`${formatUtcFull(end.time)} (synthetic)`}>{formatUtcWithDay(end.time)}</span>
        </div>
      </div>
      {!start && icon}
    </div>
  );
}

/**
 * A caption over its value, e.g. the stand's pier over the stand, aligned to
 * its column's start, centre or end. `srLabel` names the value for screen readers.
 */
function CardFact({
  caption,
  align = "start",
  srLabel,
  children,
}: {
  caption: string;
  align?: "start" | "center" | "end";
  srLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className={`ops-card-fact ops-card-fact--${align}`}>
      <span className="ops-card-caption">{caption}</span>
      <span className="ops-card-fact-value">
        {srLabel && <span className="ops-visually-hidden">{srLabel} </span>}
        {children}
      </span>
    </div>
  );
}
