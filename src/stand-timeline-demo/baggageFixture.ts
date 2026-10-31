// SYNTHETIC SAMPLE DATA: baggage reclaim at the fictional Norvara Intl
// Airport, made from the sample flights (./syntheticFixture). Invented
// carousels, bag counts, timings, outages and plan; not real baggage data or
// operations.
//
// Each pier's arrivals reclaim on that pier's carousels (the remote stands'
// on one of their own), and each stand's bags go to the carousel nearest it
// (`stands`) when a flight is moved there. Each flight carries its aircraft
// type's checked bags (BAGS_BY_TYPE), a little more or less flight to flight
// (bagsFor); they start coming off FIRST_BAG_MIN after it reaches its stand,
// BAGS_PER_MIN a minute (reclaimWindow). A carousel can be out of service
// for a while (SYNTHETIC_CAROUSEL_OUTAGES). The day's plan
// (SYNTHETIC_RECLAIM_PLAN) spreads each pier's arrivals over all its
// carousels, rather than piling them onto the nearest.

import {
  SYNTHETIC_DATE,
  SYNTHETIC_STANDS,
  SYNTHETIC_TURNS,
} from "./syntheticFixture";

export interface SyntheticCarousel {
  code: string;
  /** The stand area whose arrivals reclaim here, e.g. "Pier A". */
  area: string;
  /** The stands nearest it, whose bags it takes when a flight is moved onto one. A pier's last carousel takes its overflow. */
  stands: readonly string[];
}

// Pier A's stands face two sides: odd numbers west (1), even east (2).
export const SYNTHETIC_CAROUSELS: SyntheticCarousel[] = [
  { code: "1", area: "Pier A", stands: ["A1", "A3", "A5"] },
  { code: "2", area: "Pier A", stands: ["A2", "A4", "A6"] },
  { code: "3", area: "Pier A", stands: [] },
  { code: "4", area: "Pier B", stands: ["B10", "B11"] },
  { code: "5", area: "Pier B", stands: ["B12", "B14"] },
  { code: "6", area: "Pier B", stands: ["B15", "B16"] },
  { code: "7", area: "Pier C", stands: ["C20", "C21", "C22"] },
  { code: "8", area: "Pier C", stands: ["C23", "C24", "C25"] },
  { code: "9", area: "Pier C", stands: ["C26", "C27"] },
  { code: "10", area: "Pier D", stands: ["D40", "D41", "D42"] },
  { code: "11", area: "Pier D", stands: ["D43", "D44"] },
  { code: "12", area: "Remote", stands: ["R1", "R2", "R3", "R4"] },
];

/** A carousel out of service for a while, from `from` to `to` ("HH:MM" UTC on SYNTHETIC_DATE). */
export interface CarouselOutage {
  carousel: string;
  from: string;
  to: string;
  reason: string;
}

/** Planned work and faults on the day: no bags come off a carousel while it is out. */
export const SYNTHETIC_CAROUSEL_OUTAGES: CarouselOutage[] = [
  { carousel: "2", from: "12:00", to: "13:30", reason: "Belt maintenance" },
  { carousel: "9", from: "10:00", to: "11:00", reason: "Belt fault" },
  { carousel: "11", from: "14:30", to: "16:00", reason: "Belt maintenance" },
];

/** Minutes from on-block to the first bag on the carousel. */
export const FIRST_BAG_MIN = 10;

/** Bags a carousel takes off a minute. */
export const BAGS_PER_MIN = 7;

/** The fewest minutes a flight's bags take to come off, however few: the belt's run. */
export const MIN_RECLAIM_MIN = 20;

/** Checked bags on a typical flight, by aircraft type: a widebody carries more. */
export const BAGS_BY_TYPE: Readonly<Record<string, number>> = {
  E195: 85,
  A319: 100,
  A320: 125,
  B738: 130,
  B38M: 135,
  A321: 150,
  B788: 215,
  A339: 235,
  B789: 255,
  B77W: 320,
};

/** For a flight whose aircraft type is not recorded. */
const DEFAULT_BAGS = 120;

const MINUTE = 60_000;
const STAND_AREA = new Map(SYNTHETIC_STANDS.map((stand) => [stand.code, stand.area]));
const at = (hhmm: string) => Date.parse(`${SYNTHETIC_DATE}T${hhmm}:00Z`);

/** The carousel nearest a stand, which its bags go to when a flight is moved onto it; undefined for no stand. */
export const standCarousel = (stand: string): SyntheticCarousel | undefined =>
  SYNTHETIC_CAROUSELS.find((carousel) => carousel.stands.includes(stand));

/**
 * A flight's checked bags: its aircraft type's, from 12% fewer to 12% more,
 * the same for the same flight (`flightKey`, its turn's id) every time.
 */
export function bagsFor(flightKey: string, aircraftType: string | undefined): number {
  let hash = 0;
  for (const char of flightKey) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return Math.round((BAGS_BY_TYPE[aircraftType ?? ""] ?? DEFAULT_BAGS) * (0.88 + (hash % 25) / 100));
}

/** When an arrival's `bags` come off, from when it reaches its stand (epoch ms). */
export function reclaimWindow(onBlock: number, bags: number): [number, number] {
  const start = onBlock + FIRST_BAG_MIN * MINUTE;
  return [start, start + Math.max(MIN_RECLAIM_MIN, Math.ceil(bags / BAGS_PER_MIN)) * MINUTE];
}

/** Each outage, in epoch ms. */
export const CAROUSEL_OUTAGES = SYNTHETIC_CAROUSEL_OUTAGES.map((outage) => ({
  ...outage,
  start: at(outage.from),
  end: at(outage.to),
}));

/** The outage on `carousel` that overlaps `start`–`end`, if any. */
export const outageDuring = (carousel: string, start: number, end: number) =>
  CAROUSEL_OUTAGES.find((outage) => outage.carousel === carousel && outage.start < end && start < outage.end);

/**
 * The day's plan: each arrival's carousel, by turn id. Deterministic, not an
 * allocator: in order of arrival, each takes the carousel on its pier that
 * has stood empty longest and is not out of service then, its stand's own on
 * a tie, so the pier's flights spread over all its carousels; with none
 * free, the one that clears soonest. Only a turn whose first stay starts with
 * its arrival flight has bags to reclaim, and only one arriving on the day
 * (not overnight).
 */
function planReclaims(): Map<string, string> {
  const arrivals = SYNTHETIC_TURNS.flatMap((turn) => {
    const stay = turn.stays[0];
    if (!stay || (stay.start ?? "flight") !== "flight" || stay.dayOffset) return [];
    const [start, end] = reclaimWindow(at(stay.onBlock), bagsFor(turn.turnId, turn.aircraftType));
    return [{ turnId: turn.turnId, stand: stay.stand, start, end }];
  }).sort((a, b) => a.start - b.start);
  const clearAt = new Map<string, number>();
  const plan = new Map<string, string>();
  for (const arrival of arrivals) {
    const home = standCarousel(arrival.stand);
    const pier = SYNTHETIC_CAROUSELS.filter((carousel) => carousel.area === STAND_AREA.get(arrival.stand));
    const order = home ? [home, ...pier.filter((carousel) => carousel !== home)] : pier;
    if (order.length === 0) continue;
    const clear = (code: string) => clearAt.get(code) ?? 0;
    const open = order.filter((carousel) => !outageDuring(carousel.code, arrival.start, arrival.end));
    const free = open.filter((carousel) => clear(carousel.code) <= arrival.start);
    // Stable: on a tie, the stand's own carousel stays first.
    const pick =
      [...free].sort((a, b) => clear(a.code) - clear(b.code))[0] ??
      (open.length > 0 ? open : order).reduce((soonest, carousel) => (clear(carousel.code) < clear(soonest.code) ? carousel : soonest));
    plan.set(arrival.turnId, pick.code);
    clearAt.set(pick.code, Math.max(clear(pick.code), arrival.end));
  }
  return plan;
}

export const SYNTHETIC_RECLAIM_PLAN: ReadonlyMap<string, string> = planReclaims();
