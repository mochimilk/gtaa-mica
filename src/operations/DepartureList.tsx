import { useMemo } from "react";
import { FlightList } from "./FlightList";
import { useOperations } from "./OperationsContext";

export function DepartureList() {
  // Lists show only matching flights (the chart dims instead of hiding).
  const { matcher, dataset } = useOperations();
  const flights = useMemo(() => dataset.departures.filter(matcher.flight), [matcher, dataset]);
  const scheduled = dataset.timeBasis === "scheduled";
  return (
    <FlightList
      flights={flights}
      label="Departures"
      routeHeader="To"
      timeHeader={scheduled ? "STD" : "ETD"}
      timeHeaderLabel={scheduled ? "Scheduled time of departure" : "Estimated time of departure"}
      emptyMessage={
        matcher.active
          ? "No departures match the current view and filters."
          : "No synthetic departures in this window."
      }
    />
  );
}
