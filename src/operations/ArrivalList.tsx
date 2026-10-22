import { useMemo } from "react";
import { FlightList } from "./FlightList";
import { useOperations } from "./OperationsContext";

export function ArrivalList() {
  // Lists show only matching flights (the chart dims instead of hiding).
  const { matcher, dataset } = useOperations();
  const flights = useMemo(() => dataset.arrivals.filter(matcher.flight), [matcher, dataset]);
  const scheduled = dataset.timeBasis === "scheduled";
  return (
    <FlightList
      flights={flights}
      label="Arrivals"
      routeHeader="From"
      timeHeader={scheduled ? "STA" : "ETA"}
      timeHeaderLabel={scheduled ? "Scheduled time of arrival" : "Estimated time of arrival"}
      emptyMessage={
        matcher.active
          ? "No arrivals match the current view and filters."
          : "No synthetic arrivals in this window."
      }
    />
  );
}
