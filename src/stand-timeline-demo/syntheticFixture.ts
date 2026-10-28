// SYNTHETIC SAMPLE DATA at the fictional Norvara Intl Airport.
// Invented carriers (XA–XD), flight numbers, registrations, stands and times.
// Route endpoints use familiar airport codes (see ./airports) purely as
// illustrative synthetic values; they are not real routes or schedules. Not
// real flights or operations, and not derived from any ARIS/GateView source.

import { ROUTE_AIRPORTS } from "./airports";

/**
 * Sample stand size. A "narrow" stand takes narrowbodies only; a "wide" one
 * takes any aircraft. Chosen so the day's plan below fits as it stands; not
 * real stand data.
 */
export type StandSize = "narrow" | "wide";

export interface SyntheticStand {
  code: string;
  area: string;
  size: StandSize;
}

export interface SyntheticStay {
  stand: string;
  onBlock: string; // "HH:MM" UTC on SYNTHETIC_DATE
  offBlock: string;
  dayOffset?: number; // -1 = previous day
  /**
   * What begins (`start`) and ends (`end`) this stay: an actual flight, a tow,
   * or no recorded event. One value per side, so flight and tow can't both be
   * claimed. When omitted: the visit's first stay starts with its arrival
   * flight, its last stay ends with its departure flight, and every other side
   * is "none". A tow is never inferred; it must be set explicitly.
   */
  start?: StayEvent;
  end?: StayEvent;
  /*
   * Running late. `onBlock`–`offBlock` are the hours the aircraft is both
   * scheduled and expected on the stand; a delay adds the rest, which the
   * chart draws as a ghost reaching out from the bar.
   */
  /** Minutes the aircraft reaches the stand behind schedule: `onBlock` is expected, scheduled that much earlier. */
  delayIn?: number;
  /** Minutes the aircraft leaves the stand behind schedule: `offBlock` is scheduled, expected that much later. */
  delayOut?: number;
}

export type StayEvent = "flight" | "tow" | "none";

export interface SyntheticTurn {
  turnId: string;
  carrier: string;
  arrFlight: string;
  depFlight: string;
  /** Displayed route endpoint of the inbound flight (not necessarily the previous stop). */
  origin: string;
  /** Displayed route endpoint of the outbound flight (not necessarily the next stop). */
  destination: string;
  registration: string;
  aircraftType: string;
  /** One stay per stand; a visit may span several stands. */
  stays: SyntheticStay[];
}

export const SYNTHETIC_DATE = "2026-01-15";
export const SYNTHETIC_WINDOW = { from: "05:00", to: "17:00" };

export const SYNTHETIC_STANDS: SyntheticStand[] = [
  { code: "A1", area: "Pier A", size: "narrow" },
  { code: "A2", area: "Pier A", size: "wide" },
  { code: "A3", area: "Pier A", size: "wide" },
  { code: "A4", area: "Pier A", size: "narrow" },
  { code: "A5", area: "Pier A", size: "wide" },
  { code: "A6", area: "Pier A", size: "wide" },
  { code: "B10", area: "Pier B", size: "wide" },
  { code: "B11", area: "Pier B", size: "wide" },
  { code: "B12", area: "Pier B", size: "wide" },
  { code: "B14", area: "Pier B", size: "narrow" },
  { code: "B15", area: "Pier B", size: "wide" },
  { code: "B16", area: "Pier B", size: "wide" },
  { code: "C20", area: "Pier C", size: "wide" },
  { code: "C21", area: "Pier C", size: "wide" },
  { code: "C22", area: "Pier C", size: "wide" },
  { code: "C23", area: "Pier C", size: "wide" },
  { code: "C24", area: "Pier C", size: "wide" },
  { code: "C25", area: "Pier C", size: "wide" }, // intentionally empty all day
  { code: "C26", area: "Pier C", size: "wide" },
  { code: "C27", area: "Pier C", size: "narrow" },
  { code: "D40", area: "Pier D", size: "wide" },
  { code: "D41", area: "Pier D", size: "wide" },
  { code: "D42", area: "Pier D", size: "wide" },
  { code: "D43", area: "Pier D", size: "wide" },
  { code: "D44", area: "Pier D", size: "narrow" },
  { code: "R1", area: "Remote", size: "wide" },
  { code: "R2", area: "Remote", size: "wide" },
  { code: "R3", area: "Remote", size: "wide" },
  { code: "R4", area: "Remote", size: "wide" },
];

/** Sample size class of each aircraft type: widebodies need a "wide" stand. */
export const AIRCRAFT_SIZE: Readonly<Record<string, StandSize>> = {
  A319: "narrow",
  A320: "narrow",
  A321: "narrow",
  B738: "narrow",
  B38M: "narrow",
  E195: "narrow",
  B788: "wide",
  B789: "wide",
  B77W: "wide",
  A339: "wide",
};

/** Manufacturer of each sample aircraft type, for display. */
export const AIRCRAFT_MAKER: Readonly<Record<string, string>> = {
  A319: "Airbus",
  A320: "Airbus",
  A321: "Airbus",
  A339: "Airbus",
  B738: "Boeing",
  B38M: "Boeing",
  B788: "Boeing",
  B789: "Boeing",
  B77W: "Boeing",
  E195: "Embraer",
};

const turn = (
  turnId: string,
  carrier: string,
  [arr, dep]: [string, string],
  [origin, destination]: [string, string],
  registration: string,
  aircraftType: string,
  stays: SyntheticStay[],
): SyntheticTurn => ({
  turnId,
  carrier,
  arrFlight: `${carrier}${arr}`,
  depFlight: `${carrier}${dep}`,
  origin,
  destination,
  registration,
  aircraftType,
  stays,
});

const stay = (
  stand: string,
  onBlock: string,
  offBlock: string,
  dayOffset?: number,
  events?: Pick<SyntheticStay, "start" | "end" | "delayIn" | "delayOut">,
): SyntheticStay => ({
  stand,
  onBlock,
  offBlock,
  dayOffset,
  ...events,
});

// Explicit synthetic tow transfers between consecutive stays of one visit.
const TOW_OUT = { end: "tow" } as const;
const TOW_IN = { start: "tow" } as const;
const TOW_IN_OUT = { start: "tow", end: "tow" } as const;

const HAND_WRITTEN_TURNS: SyntheticTurn[] = [
  turn("T01", "XA", ["101", "102"], ["SFO", "LAX"], "C-SYAA", "A320", [stay("A1", "04:10", "06:05")]),
  // Leaves A1 15 minutes late, clear of T03's arrival at 09:00. The plan
  // starts with no conflicts: the day's disruption arrives live (see
  // src/operations/disruption.ts).
  turn("T02", "XA", ["103", "104"], ["SEA", "SEA"], "C-SYAB", "A320", [
    stay("A1", "06:40", "08:20", undefined, { delayOut: 15 }),
  ]),
  turn("T03", "XB", ["210", "211"], ["JFK", "BOS"], "C-SYBA", "B738", [stay("A1", "09:00", "10:15")]),
  turn("T04", "XC", ["330", "331"], ["ORD", "ORD"], "C-SYCA", "A321", [stay("A1", "12:30", "14:10")]),
  turn("T05", "XB", ["212", "213"], ["BOS", "JFK"], "C-SYBB", "B738", [stay("A2", "05:30", "07:00")]),
  // Late at both ends, with room on A2 either side.
  turn("T06", "XD", ["450", "451"], ["YVR", "YVR"], "C-SYDA", "B788", [
    stay("A2", "07:45", "11:40", undefined, { delayIn: 35, delayOut: 30 }),
  ]),
  turn("T07", "XA", ["105", "106"], ["LAX", "SFO"], "C-SYAC", "A319", [stay("A2", "13:00", "14:35")]),
  turn("T08", "XC", ["332", "333"], ["YUL", "LHR"], "C-SYCB", "E195", [stay("A3", "06:15", "07:25")]),
  turn("T23", "XA", ["115", "116"], ["SEA", "LAX"], "C-SYAH", "A320", [stay("A3", "09:20", "11:05")]),
  // Visit spanning three stands: arrival flight at B11, tow to remote R1,
  // tow to A3, departure flight from A3.
  turn("T09", "XD", ["452", "453"], ["YVR", "YUL"], "C-SYDB", "B77W", [
    stay("B11", "07:10", "08:30", undefined, TOW_OUT),
    stay("R1", "08:50", "13:20", undefined, TOW_IN_OUT),
    stay("A3", "13:40", "15:55", undefined, TOW_IN),
  ]),
  turn("T10", "XB", ["214", "215"], ["JFK", "JFK"], "C-SYBC", "B38M", [stay("A4", "08:00", "09:20")]),
  // Reaches A4 half an hour late; T10 has left by its scheduled 09:35.
  turn("T11", "XA", ["107", "108"], ["SFO", "SEA"], "C-SYAD", "A320", [
    stay("A4", "10:05", "11:15", undefined, { delayIn: 30 }),
  ]),
  turn("T12", "XC", ["334", "335"], ["LHR", "ORD"], "C-SYCC", "A321", [stay("A4", "15:20", "17:45")]),
  turn("T13", "XD", ["454", "455"], ["YUL", "YVR"], "C-SYDC", "A339", [stay("B10", "05:50", "09:10")]),
  turn("T14", "XB", ["216", "217"], ["BOS", "BOS"], "C-SYBD", "B738", [stay("B10", "11:00", "12:05")]),
  // B11's midday bank, the disruption demo's (src/operations/disruption.ts):
  // XD472/473 on time, then two arrivals close behind it. When XD472 runs
  // late, its turn runs into both, and the knock-on holds T16 and T15 too.
  turn("T24", "XD", ["472", "473"], ["LHR", "LHR"], "C-SYDG", "B789", [stay("B11", "08:40", "11:40")]),
  turn("T25", "XC", ["344", "345"], ["ORD", "ORD"], "C-SYCG", "B788", [stay("B11", "11:50", "12:55")]),
  turn("T26", "XB", ["232", "233"], ["BOS", "BOS"], "C-SYBH", "B738", [stay("B11", "13:05", "13:55")]),
  turn("T16", "XC", ["336", "337"], ["ORD", "LHR"], "C-SYCD", "E195", [stay("B11", "14:00", "15:30")]),
  turn("T15", "XA", ["109", "110"], ["LAX", "LAX"], "C-SYAE", "A319", [stay("B11", "15:45", "16:50")]),
  turn("T17", "XB", ["218", "219"], ["JFK", "BOS"], "C-SYBE", "B38M", [stay("B12", "06:00", "06:55")]),
  turn("T18", "XD", ["456", "457"], ["YVR", "YUL"], "C-SYDD", "B789", [stay("B12", "10:20", "16:30")]),
  // Leaves B14 15 minutes late, clear of the 09:10 tow-in.
  turn("T19", "XA", ["111", "112"], ["SFO", "SFO"], "C-SYAF", "A320", [
    stay("B14", "07:30", "08:45", undefined, { delayOut: 15 }),
  ]),
  turn("T20", "XC", ["338", "339"], ["LHR", "YUL"], "C-SYCE", "A321", [stay("B14", "12:10", "13:05")]),
  // Overnight on remote R2 (starts before the window), tow to B14.
  turn("T21", "XA", ["113", "114"], ["SEA", "SFO"], "C-SYAG", "A321", [
    stay("R2", "22:30", "08:40", -1, TOW_OUT),
    stay("B14", "09:10", "11:30", undefined, TOW_IN),
  ]),
  turn("T22", "XB", ["220", "221"], ["BOS", "JFK"], "C-SYBF", "B738", [stay("R2", "12:00", "14:45")]),

  // Additional hand-written cases. C27 and D44 are otherwise empty.
  turn("X01", "XC", ["340", "341"], ["ORD", "LHR"], "C-SYCF", "A321", [
    stay("C27", "06:20", "07:35", undefined, TOW_OUT),
    stay("R3", "08:00", "12:10", undefined, TOW_IN_OUT),
    stay("D44", "12:40", "14:20", undefined, TOW_IN),
  ]),
  // Plain parking occupancy: explicitly neither a flight nor a tow at either
  // end, to show that an absent flight never produces a tow marker. The visit
  // keeps its synthetic flight numbers for the description only.
  turn("X02", "XD", ["470", "471"], ["YUL", "YVR"], "C-SYDE", "B789", [
    stay("R4", "10:30", "15:50", undefined, { start: "none", end: "none" }),
  ]),
];

/* ------------------------------------------------------------------------
 * Deterministic filler: no randomness, so IDs (G01…) and times are stable.
 * Each stand cycles through fixed duration/gap tables from a stand-specific
 * start, giving varied lengths and empty periods. It is not an allocator.
 */

const GENERATED_STANDS = [
  "A5", "A6", "B15", "B16", "C20", "C21", "C22", "C23", "C24", "C26",
  "D40", "D41", "D42", "D43",
];
const DURATIONS = [55, 75, 140, 45, 95, 210, 65, 120, 50, 85]; // minutes on stand
const GAPS = [30, 95, 40, 180, 25, 60, 35, 130, 45, 20]; // empty minutes after
const CARRIERS = ["XA", "XB", "XC", "XD"];
const TYPES = ["A320", "B738", "A321", "E195", "B38M", "A319", "B789", "A339"];
const WINDOW_END_MIN = 17 * 60;

function clock(min: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function generateTurns(): SyntheticTurn[] {
  const out: SyntheticTurn[] = [];
  let n = 0;
  GENERATED_STANDS.forEach((stand, i) => {
    let t = 270 + ((i * 47) % 150); // first on-block between 04:30 and 06:59
    for (let k = 0; t < WINDOW_END_MIN; k++) {
      const dur = DURATIONS[(i * 3 + k) % DURATIONS.length];
      const gap = GAPS[(i * 7 + k) % GAPS.length];
      n++;
      const carrier = CARRIERS[(i + k) % CARRIERS.length];
      const arr = 600 + 2 * n;
      const reg = `C-SZ${String.fromCharCode(65 + Math.floor((n - 1) / 26), 65 + ((n - 1) % 26))}`;
      out.push(
        turn(
          `G${String(n).padStart(2, "0")}`,
          carrier,
          [String(arr), String(arr + 1)],
          [ROUTE_AIRPORTS[(n * 5) % 9], ROUTE_AIRPORTS[(n * 7 + 3) % 9]],
          reg,
          TYPES[(n * 3) % TYPES.length],
          [stay(stand, clock(t), clock(t + dur))],
        ),
      );
      t += dur + gap;
    }
  });
  return out;
}

export const SYNTHETIC_TURNS: SyntheticTurn[] = [...HAND_WRITTEN_TURNS, ...generateTurns()];
