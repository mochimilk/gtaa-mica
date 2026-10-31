// Baggage reclaim as the board stands (../stand-timeline-demo/baggageFixture):
// which carousel each arriving flight's bags come off, how many, and when;
// what a stand change does to them, for baggage to see on the call's shared
// screen; and the day's reclaim in figures, as the board has its KPIs.
//
// A flight's bags keep the carousel the day's plan gave them while its stay
// is on that carousel's pier, at its times now (a late arrival's bags come
// off late). Moved to another pier, or given a stand, they go to the new
// stand's carousel; where another flight's bags are on it then, or it is out
// of service, the two clash, and that is the conflict baggage has to sort
// out. Nothing here re-plans the carousels.
import type { Millis } from "../stand-timeline";
import {
  bagsFor,
  CAROUSEL_OUTAGES,
  outageDuring,
  reclaimWindow,
  standCarousel,
  SYNTHETIC_CAROUSELS,
  SYNTHETIC_RECLAIM_PLAN,
} from "../stand-timeline-demo/baggageFixture";
import { DEMO_DATA, DEMO_DOMAIN, formatUtc } from "../stand-timeline-demo/demoData";
import { flightsAtStay, occupancyById, standArea, type StayPlace } from "./allocation";
import { ARRIVALS, type OpsFlight } from "./operationsData";

/** One arrival's bags on a carousel: from the first bag off to the last. */
export type Reclaim = {
  /** "bags:T25-1", or with ":was" / ":now" for a change's (bagMove). */
  id: string;
  stayId: string;
  /** The arrival, "XC344", and where from, "ORD". */
  flight: string;
  origin: string;
  /** Its aircraft type, "B788", when recorded. */
  aircraftType?: string;
  /** How many checked bags come off. */
  bags: number;
  carousel: string;
  start: Millis;
  end: Millis;
  /** How late its arrival reaches its stand, ms, so its bags come off that much later than planned; 0 on time. */
  lateMs: Millis;
};

const CAROUSEL_AREA = new Map(SYNTHETIC_CAROUSELS.map((carousel) => [carousel.code, carousel.area]));

/** The carousel an arrival's bags go to on `stand`: the plan's while it is on that carousel's pier, else the stand's own. */
function carouselOn(flight: OpsFlight, stand: string): string | undefined {
  const planned = flight.visitId ? SYNTHETIC_RECLAIM_PLAN.get(flight.visitId) : undefined;
  if (planned && CAROUSEL_AREA.get(planned) === standArea(stand)) return planned;
  return standCarousel(stand)?.code;
}

/** Where an arrival's bags come off with its stay at `place`; undefined off a stand. */
function reclaimAt(flight: OpsFlight, stayId: string, place: StayPlace, id: string): Reclaim | undefined {
  const carousel = place.rowId ? carouselOn(flight, place.rowId) : undefined;
  if (!carousel) return undefined;
  const bags = bagsFor(flight.visitId ?? flight.id, flight.aircraftType);
  const [start, end] = reclaimWindow(place.start, bags);
  const lateMs = DEMO_DATA.delays.get(stayId)?.in ?? 0;
  return { id, stayId, flight: flight.flight, origin: flight.routeEnd, aircraftType: flight.aircraftType, bags, carousel, start, end, lateMs };
}

/** Every arrival's bags on the board now, in order of arrival. */
export function reclaims(): Reclaim[] {
  return ARRIVALS.flatMap((flight) => {
    const stay = flight.occupancyId ? occupancyById(flight.occupancyId) : undefined;
    if (!stay) return [];
    return reclaimAt(flight, stay.id, { rowId: stay.rowId, start: stay.start, end: stay.end }, `bags:${stay.id}`) ?? [];
  }).sort((a, b) => a.start - b.start);
}

/** What a stand change does to a flight's bags. */
export type BagMove = {
  /** Where they came off before the change; undefined when the stay had no stand. */
  was?: Reclaim;
  /** Where they come off after it; undefined when it has none now. */
  now?: Reclaim;
  /** Other flights' bags on `now`'s carousel at the same time. */
  clashes: Reclaim[];
  /** The outage on `now`'s carousel then, if it is out of service. */
  outage?: (typeof CAROUSEL_OUTAGES)[number];
  /** Every other arrival's bags, as the board stands. */
  others: Reclaim[];
};

const overlaps = (a: Reclaim, b: Reclaim) => a.carousel === b.carousel && a.start < b.end && b.start < a.end;

/**
 * What moving a stay from `from` to `to` does to its arrival's bags, against
 * everyone else's as the board stands; null for a stay that starts with no
 * arrival (a tow-in), which has no bags to reclaim.
 */
export function bagMove(stayId: string, from: StayPlace, to: StayPlace): BagMove | null {
  const flight = flightsAtStay(stayId).find((candidate) => candidate.direction === "arrival");
  if (!flight) return null;
  const others = reclaims().filter((reclaim) => reclaim.stayId !== stayId);
  const was = reclaimAt(flight, stayId, from, `bags:${stayId}:was`);
  const now = reclaimAt(flight, stayId, to, `bags:${stayId}:now`);
  return {
    was,
    now,
    clashes: now ? others.filter((other) => overlaps(other, now)) : [],
    outage: now ? outageDuring(now.carousel, now.start, now.end) : undefined,
    others,
  };
}

/**
 * The move in words, for baggage: "XC344's 212 bags move from carousel 4 to
 * carousel 1, 12:00–12:36", "Bags stay on carousel 4, now 13:15–13:38",
 * "Bags stay on carousel 4"; then any clash: "XD608's are on carousel 1
 * until 12:17", and any outage.
 */
export function describeBagMove({ was, now, clashes, outage }: BagMove): string {
  const times = (reclaim: Reclaim) => `${formatUtc(reclaim.start)}–${formatUtc(reclaim.end)}`;
  const bags = (reclaim: Reclaim) => `${reclaim.flight}'s ${reclaim.bags} bags`;
  const moved = !now
    ? was
      ? `${bags(was)} no longer come off carousel ${was.carousel}`
      : "No bags to reclaim"
    : !was
      ? `${bags(now)} go to carousel ${now.carousel}, ${times(now)}`
      : was.carousel !== now.carousel
        ? `${bags(now)} move from carousel ${was.carousel} to carousel ${now.carousel}, ${times(now)}`
        : was.start !== now.start
          ? `${bags(now)} stay on carousel ${now.carousel}, now ${times(now)}`
          : `${bags(now)} stay on carousel ${now.carousel}, ${times(now)}`;
  if (!now) return moved;
  const parts = [moved];
  if (clashes.length > 0) {
    const [first, ...more] = clashes;
    const whose = more.length > 0 ? `${first.flight}'s and ${more.length} more` : `${first.flight}'s`;
    parts.push(`${whose} are on carousel ${now.carousel} until ${formatUtc(Math.max(...clashes.map((clash) => clash.end)))}`);
  }
  if (outage) parts.push(`Carousel ${now.carousel} is out for ${outage.reason.toLowerCase()} ${outage.from}–${outage.to}`);
  return parts.join(". ");
}

/** The day's reclaim in figures, over the chart's window, for the baggage pane. */
export type BaggageDay = {
  /** Arrivals with bags to reclaim. */
  flights: number;
  bags: number;
  /** The busiest hour on the carousels: when it starts, and how many flights' bags come off in it. */
  peak: { from: Millis; flights: number } | null;
  /** Carousels out of service at some point. */
  outages: number;
  /** Flights whose bags come off where another's are, or on a carousel out of service, then. */
  clashes: number;
};

const HOUR = 3_600_000;

/** The day's reclaim as the board stands, given every arrival's bags (`all`, reclaims() by default). */
export function baggageDay(all: readonly Reclaim[] = reclaims()): BaggageDay {
  const [from, to] = DEMO_DOMAIN;
  const inWindow = all.filter((reclaim) => reclaim.end > from && reclaim.start < to);
  let peak: BaggageDay["peak"] = null;
  for (let hour = from; hour < to; hour += HOUR) {
    const flights = inWindow.filter((reclaim) => reclaim.start < hour + HOUR && reclaim.end > hour).length;
    if (flights > (peak?.flights ?? 0)) peak = { from: hour, flights };
  }
  const clashing = inWindow.filter(
    (reclaim) =>
      !!outageDuring(reclaim.carousel, reclaim.start, reclaim.end) ||
      inWindow.some((other) => other !== reclaim && overlaps(other, reclaim)),
  );
  return {
    flights: inWindow.length,
    bags: inWindow.reduce((sum, reclaim) => sum + reclaim.bags, 0),
    peak,
    outages: new Set(CAROUSEL_OUTAGES.map((outage) => outage.carousel)).size,
    clashes: clashing.length,
  };
}
