// Concise status for an active view/filter: match counts, that dimmed bars
// remain occupied, an explicit empty-match state, and a reset. Renders
// nothing when no view or filter is active.
import { Button } from "@fluentui/react-components";
import { useOperations } from "./OperationsContext";

export function FilterStatus() {
  const { matcher, setView, resetFilters, dataset: { timeline: DEMO_DATA, flights: OPS_FLIGHTS } } = useOperations();
  if (!matcher.active) return null;

  const stays = DEMO_DATA.occupancies.filter((o) => matcher.occupancy(o.id)).length;
  const flights = OPS_FLIGHTS.filter(matcher.flight).length;
  const reset = () => {
    setView("all");
    resetFilters();
  };

  return (
    <p className="ops-filter-status" role="status">
      {stays === 0 ? (
        <>No stays match. {flights} of {OPS_FLIGHTS.length} flights match. All occupied stays remain on the chart.</>
      ) : (
        <>
          {stays} of {DEMO_DATA.occupancies.length} stays and {flights} of{" "}
          {OPS_FLIGHTS.length} flights match. Dimmed bars are still occupied.
        </>
      )}{" "}
      <Button size="small" appearance="transparent" data-ops-keep-selection="" onClick={reset}>
        Reset view and filters
      </Button>
    </p>
  );
}
