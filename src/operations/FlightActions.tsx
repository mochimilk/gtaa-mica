// Selection details shown inside the selection popover. Revealing the bar is
// automatic and closing the popover clears the selection, so the only action
// here is the backend-dependent one, disabled with a visible explanation.
import { Button } from "@fluentui/react-components";
import { airportLabel } from "../stand-timeline-demo/airports";
import { standLabel } from "../stand-timeline-demo/adapter";
import { formatUtcFull, formatUtcWithDay } from "../stand-timeline-demo/demoData";
import { selectedFlight, useOperations } from "./OperationsContext";
import type { OpsFlight } from "./operationsData";

export function FlightActions() {
  const { selection, dataset } = useOperations();
  const flight = selectedFlight(selection, dataset);

  return (
    <div className="ops-actions">
      <div className="ops-details">
        {flight ? (
          <FlightDetails flight={flight} />
        ) : selection.occupancyIds.length > 0 ? (
          <StaySummary occupancyIds={selection.occupancyIds} />
        ) : (
          <p className="ops-empty">Nothing selected.</p>
        )}
      </div>
      <div className="ops-action-row">
        <Button size="small" disabled aria-describedby="ops-assign-note">
          Assign stand
        </Button>
      </div>
      <p id="ops-assign-note" className="ops-footnote">
        Assign stand is unavailable: this viewer does not execute allocation changes.
      </p>
    </div>
  );
}

/** Popover heading for the current selection. */
export function selectionTitle(occupancyIds: readonly string[], flight?: OpsFlight): string {
  if (flight) return `${flight.flight} details`;
  return `${occupancyIds.length} chart stay${occupancyIds.length === 1 ? "" : "s"} selected`;
}

function FlightDetails({ flight: f }: { flight: OpsFlight }) {
  const { dataset: { timeline: DEMO_DATA, date, timeBasis } } = useOperations();
  const turn = f.visitId ? DEMO_DATA.turnsById.get(f.visitId) : undefined;
  const stays = f.visitId ? DEMO_DATA.occupancies.filter((o) => o.visitId === f.visitId) : [];
  return (
    <>
      <div>
        {f.direction === "arrival" ? "From" : "To"} {airportLabel(f.routeEnd)}
      </div>
      <div>
        {timeBasis === "scheduled" ? "Scheduled" : "Est."} {formatUtcFull(f.estimate)} <span className="ops-muted">(synthetic)</span>
      </div>
      <div>
        {f.standId ? (
          <>Stand {standLabel(DEMO_DATA, f.standId)}</>
        ) : (
          <span className="ops-muted">No stand assigned, so this flight is not on the chart.</span>
        )}
      </div>
      {(f.registration ?? turn?.registration) && (
        <div className="ops-muted">
          {[f.registration ?? turn?.registration, f.aircraftType ?? turn?.aircraftType]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {stays.length > 1 && (
        <div className="ops-muted">
          Visit stays:{" "}
          {stays
            .map((s) => `${standLabel(DEMO_DATA, s.rowId)} ${formatUtcWithDay(s.start, date)}–${formatUtcWithDay(s.end, date)}`)
            .join(" → ")}
        </div>
      )}
    </>
  );
}

function StaySummary({ occupancyIds }: { occupancyIds: string[] }) {
  const { dataset: { timeline: DEMO_DATA, flights: OPS_FLIGHTS, date } } = useOperations();
  const stays = DEMO_DATA.occupancies.filter((o) => occupancyIds.includes(o.id));
  return (
    <>
      {stays.map((s) => {
        const flights = OPS_FLIGHTS.filter((f) => f.occupancyId === s.id);
        return (
          <div key={s.id}>
            {standLabel(DEMO_DATA, s.rowId)} {formatUtcWithDay(s.start, date)}–{formatUtcWithDay(s.end, date)}{" "}
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
