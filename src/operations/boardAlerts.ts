// Synthetic demo alerts, derived from the board as it is now, so they follow
// every stand change, and listed in priority order (see currentAlerts):
//   - a conflict: a late stay whose delay runs into another stay on its stand,
//     drawn on the chart as a red ghost (see ../stand-timeline-demo/delays),
//   - a flight with no stand (it clears once the flight has one),
//   - two fixed notices about the synthetic data.
// Each states a fact present in the synthetic data; none is an allocation
// rule or a real operational alert.
import { DEMO_DATA, formatUtc, formatUtcWithDay } from "../stand-timeline-demo/demoData";
import { formatDelay, ghostClashes, ghostKey, ghostMs, GHOST_SIDES, type GhostSide } from "../stand-timeline-demo/delays";
import { allocationVersion, flightsAtStay, stayName } from "./allocation";
import { OPS_FLIGHTS, type OpsFlight } from "./operationsData";

export type AlertSeverity = "warning" | "info";
export type AlertKind = "no_stand" | "conflict" | "notice";

export interface OpsAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  /** The Alerts menu's headline, when shorter than the title (its detail and tag say the rest). */
  heading?: string;
  detail: string;
  flightId: string;
  /** When it bites (UTC): a conflict's scheduled time, a flight's estimate. Absent for a notice. */
  at?: number;
  /** For a conflict: the stand, the late stay, which end of it runs late, and the stays it runs into. */
  conflict?: { standId: string; stayId: string; side: GhostSide; intoIds: string[] };
}

const NOTICES: readonly OpsAlert[] = [
  {
    id: "ALERT-T09-TOWS",
    kind: "notice",
    severity: "info",
    title: "XD452/453 is towed twice",
    detail: "Synthetic visit across B11, R1 and A3 with explicit tow-out/tow-in.",
    flightId: "T09-ARR",
  },
  {
    id: "ALERT-T12-WINDOW",
    kind: "notice",
    severity: "info",
    title: "XC335 departs after 17:00 UTC",
    detail: "Its stay continues past the visible synthetic window.",
    flightId: "T12-DEP",
  },
];

function noStandAlert(flight: OpsFlight): OpsAlert {
  const stay = flight.unplacedStay;
  return {
    id: `ALERT-${flight.id}`,
    kind: "no_stand",
    severity: "warning",
    title: `${flight.flight} has no stand`,
    detail: stay
      ? `Needs a stand ${formatUtcWithDay(stay.start)}–${formatUtcWithDay(stay.end)} UTC; it's waiting in the No stand row.`
      : "No stay times in the synthetic data yet, so it cannot be placed on a stand.",
    flightId: flight.id,
    at: stay?.start ?? flight.estimate,
  };
}

/** One alert per late stay's ghost that runs into another stay on its stand. */
function conflictAlerts(): OpsAlert[] {
  const clashes = ghostClashes(DEMO_DATA.occupancies, DEMO_DATA.delays);
  const found: { at: number; alert: OpsAlert }[] = [];
  for (const stay of DEMO_DATA.occupancies) {
    const delay = DEMO_DATA.delays.get(stay.id);
    for (const side of GHOST_SIDES) {
      const others = clashes.get(ghostKey(stay.id, side));
      if (!others?.length) continue;
      const late = side === "start" ? "arrival" : "departure";
      const flights = flightsAtStay(stay.id);
      // The late flight, so selecting the alert shows the stay running late.
      const flight = flights.find((entry) => entry.direction === late) ?? flights[0] ?? flightsAtStay(others[0].id)[0];
      if (!flight) continue;
      const ms = ghostMs(delay, side);
      const into = others.map(stayName).join(", ");
      const [scheduled, expected] = side === "start" ? [stay.start - ms, stay.start] : [stay.end, stay.end + ms];
      found.push({
        at: scheduled,
        alert: {
          at: scheduled,
          conflict: { standId: stay.rowId, stayId: stay.id, side, intoIds: others.map((other) => other.id) },
          id: `ALERT-CLASH-${stay.id}-${side}`,
          kind: "conflict",
          severity: "warning",
          title:
            side === "end"
              ? `${stayName(stay)} runs ${formatDelay(ms)} late off ${stay.rowId}, into ${into}`
              : `${stayName(stay)} runs ${formatDelay(ms)} late onto ${stay.rowId}, over ${into}`,
          heading: `${stayName(stay)} running late by ${formatDelay(ms)}`,
          detail:
            `${side === "end" ? "Scheduled off" : "Scheduled on"} ${formatUtc(scheduled)}, expected ` +
            `${formatUtc(expected)} UTC, while ${into} ${others.length === 1 ? "is" : "are"} on ${stay.rowId}.`,
          flightId: flight.id,
        },
      });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.alert);
}

let cached: { version: number; alerts: readonly OpsAlert[] } | null = null;

/**
 * Every demo alert on the board now, open or acknowledged, most pressing
 * first: conflicts (soonest first), since a late stay is already running into
 * another; then flights with no stand that can be given one (soonest first);
 * then flights with no stay times, which cannot be placed until they have
 * some; then the notices, which ask nothing of anyone. Rebuilt when a stand
 * changes.
 */
export function currentAlerts(): readonly OpsAlert[] {
  const version = allocationVersion();
  if (cached?.version !== version) {
    const noStand = OPS_FLIGHTS.filter((flight) => !flight.standId).sort(
      (a, b) =>
        Number(!a.unplacedStay) - Number(!b.unplacedStay) ||
        a.estimate - b.estimate ||
        a.flight.localeCompare(b.flight),
    );
    cached = { version, alerts: [...conflictAlerts(), ...noStand.map(noStandAlert), ...NOTICES] };
  }
  return cached.alerts;
}

/** An alert on the board now, by id. */
export const alertById = (id: string): OpsAlert | undefined => currentAlerts().find((alert) => alert.id === id);

/** A flight's open alerts, for list row issue markers. */
export function alertsForFlight(flightId: string, acknowledged: ReadonlySet<string>): OpsAlert[] {
  return currentAlerts().filter((alert) => alert.flightId === flightId && !acknowledged.has(alert.id));
}
