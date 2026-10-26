// App-owned airport reference for the synthetic demo. The demo is set at
// Toronto Pearson (YYZ); the route airports are familiar codes used only as
// illustrative synthetic endpoints, not real routes or schedules.
import airportCatalog from "../../data/airports.json";

export const HOME_AIRPORT = { code: "YYZ", name: "Toronto Pearson International" } as const;

/** Route endpoint codes used by the synthetic fixture, in a fixed order. */
export const ROUTE_AIRPORTS = ["SFO", "LAX", "SEA", "JFK", "BOS", "ORD", "YVR", "YUL", "LHR"] as const;

export const AIRPORT_NAMES: Record<string, string> = Object.fromEntries(
  airportCatalog.airports.map(airport => [airport.code, airport.name]),
);

/** "SEA (Seattle–Tacoma International)", or just the code if unknown. */
export const airportLabel = (code: string) =>
  AIRPORT_NAMES[code] ? `${code} (${AIRPORT_NAMES[code]})` : code;
