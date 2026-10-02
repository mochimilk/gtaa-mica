import { useMemo } from "react";
import { FlightList } from "./FlightList";
import { useOperations } from "./OperationsContext";
import { DEPARTURES } from "./operationsData";

export function DepartureList() {
  // Lists show only matching flights (the chart dims instead of hiding).
  const { matcher } = useOperations();
  const flights = useMemo(() => DEPARTURES.filter(matcher.flight), [matcher]);
  return (
    <FlightList
      flights={flights}
      label="Departures"
      routeHeader="To"
      timeHeader="ETD"
      timeHeaderLabel="Estimated time of departure"
      emptyMessage={
        matcher.active
          ? "No departures match the current view and filters."
          : "No synthetic departures in this window."
      }
    />
  );
}
