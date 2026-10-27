// Selection details shown inside the selection popover when three or more
// chart stays are selected (one flight or stay gets FlightCard, two get
// SwapCard; a pair falls back here only if one has no stand). Revealing the
// bars is automatic and closing the popover clears the selection. The actions
// are the demo stand changes: Swap for two selected stays, enabled only when
// they can trade stands under the sample rules (see ./allocation) and made
// only once approved beside the two stays; and Reset once anything has changed. A
// stay can also be dragged to another stand, and dragged into or out of the
// No stand lane, which is how Skye's cursor gives and takes stands
// (agentGestures.ts).
import { useId } from "react";
import { Button } from "@fluentui/react-components";
import { DEMO_DATA, formatUtcWithDay } from "../stand-timeline-demo/demoData";
import { checkSwap, hasStandChanges, occupancyById, stayName } from "./allocation";
import { useOperations } from "./OperationsContext";
import { OPS_FLIGHTS, type OpsFlight } from "./operationsData";

export function FlightActions() {
  const { selection, requestSwap, resetStands } = useOperations();
  const noteId = useId();
  const pair = selection.occupancyIds.length === 2 ? selection.occupancyIds : null;
  const swap = pair ? checkSwap(pair[0], pair[1]) : null;
  const note = !pair
    ? undefined
    : swap?.ok
      ? "Checked against the sample rules only: no overlap, and the stand size fits the aircraft."
      : swap?.reason;

  return (
    <div className="ops-actions">
      <div className="ops-details">
        {selection.occupancyIds.length > 0 ? (
          <StaySummary occupancyIds={selection.occupancyIds} />
        ) : (
          <p className="ops-empty">Nothing selected.</p>
        )}
      </div>
      <div className="ops-action-row">
        <Button
          size="small"
          appearance="primary"
          disabled={!swap?.ok}
          aria-describedby={note ? noteId : undefined}
          data-ops-swap=""
          onClick={() => pair && requestSwap(pair[0], pair[1])}
        >
          Swap
        </Button>
        {hasStandChanges() && (
          <Button size="small" data-ops-reset-stands="" onClick={resetStands}>
            Reset stands
          </Button>
        )}
      </div>
      {note && (
        <p id={noteId} className="ops-footnote">
          {note}
        </p>
      )}
    </div>
  );
}

/** Popover heading for the current selection. */
export function selectionTitle(occupancyIds: readonly string[], flight?: OpsFlight): string {
  if (flight) return `${flight.flight} details`;
  // One stay: its whole visit's name, e.g. "XD452/453", also on a stay with only one of them.
  const one = occupancyIds.length === 1 ? occupancyById(occupancyIds[0]) : undefined;
  if (one) return DEMO_DATA.visits.find((visit) => visit.id === one.visitId)?.label ?? stayName(one);
  return `${occupancyIds.length} chart stay${occupancyIds.length === 1 ? "" : "s"} selected`;
}

function StaySummary({ occupancyIds }: { occupancyIds: string[] }) {
  const stays = DEMO_DATA.occupancies.filter((o) => occupancyIds.includes(o.id));
  return (
    <>
      {stays.map((s) => {
        const flights = OPS_FLIGHTS.filter((f) => f.occupancyId === s.id);
        return (
          <div key={s.id}>
            {s.rowId} {formatUtcWithDay(s.start)}–{formatUtcWithDay(s.end)}{" "}
            <span className="ops-muted">
              {flights.length
                ? flights.map((f) => `${f.direction === "arrival" ? "arr" : "dep"} ${f.flight}`).join(", ")
                : "no flight at this stay"}
            </span>
          </div>
        );
      })}
    </>
  );
}
