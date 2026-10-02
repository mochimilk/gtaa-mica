import { FlightList } from "./FlightList";
import { ARRIVALS } from "./operationsData";

export function ArrivalList() {
  return (
    <FlightList
      flights={ARRIVALS}
      label="Arrivals"
      routeHeader="From"
      timeHeader="ETA"
      timeHeaderLabel="Estimated time of arrival"
      emptyMessage="No synthetic arrivals in this window."
    />
  );
}
