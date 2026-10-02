import { useMemo } from "react";
import { FlightList } from "./FlightList";
import { useOperations } from "./OperationsContext";
import { ARRIVALS } from "./operationsData";

export function ArrivalList() {
  // Lists show only matching flights (the chart dims instead of hiding).
  const { matcher } = useOperations();
  const flights = useMemo(() => ARRIVALS.filter(matcher.flight), [matcher]);
  return (
    <FlightList
      flights={flights}
      label="Arrivals"
      routeHeader="From"
      timeHeader="ETA"
      timeHeaderLabel="Estimated time of arrival"
      emptyMessage={
        matcher.active
          ? "No arrivals match the current view and filters."
          : "No synthetic arrivals in this window."
      }
    />
  );
}
