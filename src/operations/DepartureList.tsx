import { FlightList } from "./FlightList";
import { DEPARTURES } from "./operationsData";

export function DepartureList() {
  return (
    <FlightList
      flights={DEPARTURES}
      label="Departures"
      routeHeader="To"
      timeHeader="ETD"
      timeHeaderLabel="Estimated time of departure"
      emptyMessage="No synthetic departures in this window."
    />
  );
}
