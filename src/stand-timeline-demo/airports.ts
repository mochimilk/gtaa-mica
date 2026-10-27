// App-owned airport reference for the synthetic demo. The demo is set at the
// fictional Norvara Intl Airport; the route airports are familiar codes used
// only as illustrative synthetic endpoints, not real routes or schedules.

export const HOME_AIRPORT = { code: "YYZ", name: "Norvara Intl" } as const;

/** Route endpoint codes used by the synthetic fixture, in a fixed order. */
export const ROUTE_AIRPORTS = ["SFO", "LAX", "SEA", "JFK", "BOS", "ORD", "YVR", "YUL", "LHR"] as const;

export const AIRPORT_NAMES: Record<string, string> = {
  SFO: "San Francisco International",
  LAX: "Los Angeles International",
  SEA: "Seattle–Tacoma International",
  JFK: "New York John F. Kennedy International",
  BOS: "Boston Logan International",
  ORD: "Chicago O'Hare International",
  YVR: "Vancouver International",
  YUL: "Montréal–Trudeau International",
  LHR: "London Heathrow",
  [HOME_AIRPORT.code]: HOME_AIRPORT.name,
};

/** "SEA (Seattle–Tacoma International)", or just the code if unknown. */
export const airportLabel = (code: string) =>
  AIRPORT_NAMES[code] ? `${code} (${AIRPORT_NAMES[code]})` : code;
