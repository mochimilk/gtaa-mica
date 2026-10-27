// The seam between the voice session and Mica's app state.
//
// The executor never touches React: it talks to this interface, which
// LiveCallProvider implements over OperationsContext. That keeps the whole
// delegation path testable and makes it obvious exactly how much of the app a
// voice request can reach — selection, views, filters, demo-alert
// acknowledgement and demo stand changes, and nothing else.
import { currentAlerts, type AlertKind } from "../operations/boardAlerts.ts";
import { OPS_FLIGHTS, OPS_FLIGHTS_BY_ID, type OpsFlight } from "../operations/operationsData.ts";
import {
  FILTER_LABELS,
  VIEWS,
  makeMatcher,
  type FilterDim,
  type OpsFilters,
  type ViewKey,
} from "../operations/opsFilters.ts";
import type { Closure, DropPlan, StandAssign } from "../operations/allocation.ts";
import type { AppAction, SelectionMode } from "./appActions.ts";
import { callingNames, guestNames } from "./callGuests.ts";

/** A flight the current selection refers to, already validated. */
export type SelectedFlightRef = {
  id: string;
  flight: string;
  direction: string;
  standId: string | null;
};

export type SnapshotSelection = {
  /** Set only when a flight was picked in a list or alert. */
  flightId: string | null;
  flightNumber: string | null;
  standId: string | null;
  occupancyIds: readonly string[];
  /**
   * Every flight the selection points at, whether it came from a list pick or
   * from selecting bars on the chart.
   *
   * A chart selection has no `flightId` — it is a set of occupancies — so
   * without this an interpreter could only see "3 chart stays" and could never
   * resolve "the selected one" or "that flight". A stay can carry an arrival
   * and a departure, and several stays can be selected, so this is a list and
   * ambiguity is left visible rather than collapsed to a guess.
   */
  flights: readonly SelectedFlightRef[];
};

/**
 * A compact, plain-text-ready picture of what the user is looking at.
 *
 * `revision` increments on every app-state change, so a result produced
 * against an older revision can be recognised as stale.
 */
export type OpsSnapshot = {
  revision: number;
  view: ViewKey;
  viewLabel: string;
  filters: OpsFilters;
  selection: SnapshotSelection;
  openAlerts: readonly { id: string; kind: AlertKind; title: string; detail: string; flightId: string }[];
  acknowledgedAlertIds: readonly string[];
  matchingFlights: number;
  totalFlights: number;
  /** Who has been called into the call and answered, besides Skye and the user. */
  callGuests: readonly string[];
  /** Who is being called in and has not answered yet. */
  callingGuests: readonly string[];
};

/** Everything a voice request is allowed to do to Mica. */
export interface OperationsHost {
  snapshot(): OpsSnapshot;
  selectFlight(flightId: string): void;
  /**
   * Selects the chart stays of several flights together, as Ctrl-clicking
   * their bars does: `replace` starts a new selection, `add` extends it.
   * Every flight passed has a stand.
   */
  selectFlights(flightIds: readonly string[], mode: SelectionMode): void;
  clearSelection(): void;
  setView(view: ViewKey): void;
  setFilter(dimension: FilterDim, values: string[]): void;
  resetFilters(): void;
  setAcknowledged(alertId: string, value: boolean): void;
  /**
   * Carries out a demo stand move or swap, already planned and checked by
   * ../operations/allocation, and selects what moved.
   */
  applyStandPlan(plan: Extract<DropPlan, { kind: "move" } | { kind: "swap" }>): void;
  /**
   * Closes a stand area and carries out the moves that clear it, already
   * planned and checked by ../operations/allocation, all at once; then
   * selects `highlightIds`, the stays that moved.
   */
  closeArea(
    closure: Closure,
    plans: readonly Extract<DropPlan, { kind: "move" }>[],
    highlightIds: readonly string[],
  ): void;
  /**
   * Gives stands to stays that have none, already planned and checked by
   * ../operations/allocation, all at once (skipping any already on their
   * stand); then selects them all.
   */
  assignStands(assigns: readonly StandAssign[]): void;
  /** Takes stays off their stands, into the No stand lane, all at once. */
  unassignStands(stayIds: readonly string[]): void;
  /**
   * Fixes everything at once (see fix_all): carries out the moves and gives
   * the stands, already planned and checked by ../operations/allocation,
   * skipping any already made; then selects `highlightIds`, what changed.
   */
  applyFixes(
    plans: readonly Extract<DropPlan, { kind: "move" }>[],
    assigns: readonly StandAssign[],
    highlightIds: readonly string[],
  ): void;
  /**
   * Shows the alerts while Skye talks about them: the Alerts window, compact,
   * with `mentioned` picked out (null keeps what was). Never over a window
   * the user has open.
   */
  showAlerts(mentioned: string | null): void;
  /** Closes Skye's compact alerts. */
  hideAlerts(): void;
  /** Calls someone from the people list into the call (the call window only). */
  addToCall(person: string): void;
  /** Takes someone off the call. */
  removeFromCall(person: string): void;
  /**
   * Carries a write out on screen before it is applied: Skye's cursor clicks
   * through the same controls a person would use. Resolves when the clicks are
   * done; the executor then applies the action anyway, which is a no-op when
   * the clicks already made the change. Optional; without it, actions apply at
   * once.
   *
   * @param signal Aborted when the job is cancelled or superseded; the gesture
   *   should stop where it is, and the action is then not applied.
   */
  gesture?(action: AppAction, signal: AbortSignal): Promise<void>;
  /**
   * Asks the user before a write that needs their say-so, before the gesture
   * runs. Resolves true to go ahead; false means they declined, and nothing is
   * done. Optional; without it, nothing is asked.
   *
   * @param signal Aborted when the job is cancelled or superseded; the
   *   question should be withdrawn.
   */
  confirm?(action: AppAction, signal: AbortSignal): Promise<boolean>;
  /**
   * Starts watching the board for a write Skye is about to make, before its
   * gesture runs. The function it returns is called once the write is done
   * (or the job stopped part way): whatever changed on the board in between
   * then waits there for approval (see ../operations/skyeReview), and it
   * returns what Skye says of the wait, or null when nothing changed.
   * `action` is the write about to be made, so a change to the board can be
   * listed as Skye's (the Outputs panel). Optional; without it, changes
   * stand at once.
   */
  beginChange?(action: AppAction): () => ChangeWait | null;
}

/**
 * What Skye says of a change waiting for approval and, when a teammate has
 * to approve it who is not on the call, her offer to call them: asked after
 * what she says, and carried out by a yes.
 */
export type ChangeWait = { say: string; offer?: { ask: string; action: AppAction } };

export function flightLabel(flight: OpsFlight): string {
  const where = flight.standId ? `stand ${flight.standId}` : "no stand";
  return `${flight.flight} (${flight.direction}, ${where})`;
}

/**
 * Builds a snapshot from raw operations state. Pure, so the provider and the
 * tests produce identical snapshots.
 */
export function buildSnapshot(input: {
  revision: number;
  view: ViewKey;
  filters: OpsFilters;
  acknowledged: ReadonlySet<string>;
  selection: { occupancyIds: readonly string[]; flightId: string | null };
}): OpsSnapshot {
  const { revision, view, filters, acknowledged, selection } = input;
  const matcher = makeMatcher(view, filters, acknowledged);
  const flight = selection.flightId ? OPS_FLIGHTS_BY_ID.get(selection.flightId) : undefined;

  // Resolve what the selection actually refers to. A list pick names one
  // flight; a chart pick names occupancies, which map to the flight endpoints
  // at those stays.
  const occupancySet = new Set(selection.occupancyIds);
  const resolved: OpsFlight[] = flight
    ? [flight]
    : OPS_FLIGHTS.filter((entry) => entry.occupancyId !== undefined && occupancySet.has(entry.occupancyId));

  return {
    revision,
    view,
    viewLabel: VIEWS.find((entry) => entry.value === view)?.label ?? view,
    filters,
    selection: {
      flightId: selection.flightId,
      flightNumber: flight?.flight ?? null,
      standId: flight?.standId ?? null,
      occupancyIds: [...selection.occupancyIds],
      flights: resolved.map((entry) => ({
        id: entry.id,
        flight: entry.flight,
        direction: entry.direction,
        standId: entry.standId ?? null,
      })),
    },
    openAlerts: currentAlerts()
      .filter((alert) => !acknowledged.has(alert.id))
      .map((alert) => ({
        id: alert.id,
        kind: alert.kind,
        title: alert.title,
        detail: alert.detail,
        flightId: alert.flightId,
      })),
    acknowledgedAlertIds: [...acknowledged],
    matchingFlights: OPS_FLIGHTS.filter((entry) => matcher.flight(entry)).length,
    totalFlights: OPS_FLIGHTS.length,
    callGuests: [...guestNames()],
    callingGuests: [...callingNames()],
  };
}

/**
 * The snapshot as plain text for `session.thinking.append`: quiet context the
 * model can use if the user asks, without being spoken on arrival.
 *
 * Kept deliberately terse. Injected content is held to a hard UTF-8 byte
 * budget (see MAX_INJECTION_BYTES), so this prioritises view, filters, counts
 * and selection, and only counts the alerts by kind.
 */
export function describeSnapshot(snapshot: OpsSnapshot): string {
  const parts: string[] = [`Mica board, synthetic data. View: ${snapshot.viewLabel}.`];

  const dimensions = (Object.keys(FILTER_LABELS) as FilterDim[])
    .filter((dimension) => snapshot.filters[dimension].length > 0)
    .map((dimension) => `${FILTER_LABELS[dimension]} ${snapshot.filters[dimension].join("/")}`);
  parts.push(dimensions.length > 0 ? `Filters: ${dimensions.join("; ")}.` : "No filters.");

  parts.push(`${snapshot.matchingFlights}/${snapshot.totalFlights} flights match.`);

  const selected = snapshot.selection.flights;
  if (snapshot.selection.flightNumber) {
    parts.push(
      `Selected ${snapshot.selection.flightNumber}` +
        `${snapshot.selection.standId ? ` on ${snapshot.selection.standId}` : ", no stand"}.`,
    );
  } else if (selected.length > 0) {
    // Named, not just counted, so "the selected one" can be resolved.
    parts.push(
      `${snapshot.selection.occupancyIds.length} stays selected, flights: ${selected
        .slice(0, 4)
        .map((entry) => `${entry.flight} ${entry.direction}${entry.standId ? ` ${entry.standId}` : ""}`)
        .join(", ")}${selected.length > 4 ? ", and more" : ""}.`,
    );
  } else if (snapshot.selection.occupancyIds.length > 0) {
    parts.push(`${snapshot.selection.occupancyIds.length} stays selected, with no flight at them.`);
  } else {
    parts.push("Nothing selected.");
  }

  parts.push(describeAlertCounts(snapshot.openAlerts));

  // Named, not just counted, so Skye never says there are none while they
  // wait in the No stand lane.
  const waiting = OPS_FLIGHTS.filter((flight) => !flight.standId);
  parts.push(
    waiting.length > 0
      ? `No stand: ${waiting
          .slice(0, 5)
          .map((flight) => flight.flight)
          .join(", ")}${waiting.length > 5 ? `, and ${waiting.length - 5} more` : ""}.`
      : "Every flight has a stand.",
  );
  if (snapshot.callGuests.length > 0) parts.push(`Also on the call: ${snapshot.callGuests.join(", ")}.`);
  if (snapshot.callingGuests.length > 0) parts.push(`Calling, not answered yet: ${snapshot.callingGuests.join(", ")}.`);

  return parts.join(" ");
}

/** "7 open alerts: 4 flights with no stand, 2 conflicts, 1 notice." */
export function describeAlertCounts(openAlerts: OpsSnapshot["openAlerts"]): string {
  if (openAlerts.length === 0) return "No open alerts.";
  const count = (kind: AlertKind) => openAlerts.filter((alert) => alert.kind === kind).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const kinds = [
    count("no_stand") && plural(count("no_stand"), "flight with no stand", "flights with no stand"),
    count("conflict") && plural(count("conflict"), "conflict", "conflicts"),
    count("notice") && plural(count("notice"), "notice", "notices"),
  ].filter(Boolean);
  return `${plural(openAlerts.length, "open alert", "open alerts")}: ${kinds.join(", ")}.`;
}
