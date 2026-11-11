// The allowlist of app actions a voice request may reach.
//
// Two rules hold everywhere in this file:
//   1. Every identifier is validated against the actual demo fixture. An
//      unknown flight, alert, view, filter dimension or filter value is
//      rejected, never coerced into something nearby.
//   2. Anything Mica cannot really do is declared "unsupported" and answered
//      with an explicit refusal, rather than quietly dropped or faked.
import { alertById, currentAlerts, type AlertKind, type OpsAlert } from "../operations/boardAlerts.ts";
import {
  OPS_FLIGHTS,
  OPS_FLIGHTS_BY_ID,
  formatDuration,
  standMinutes,
  type FlightDirection,
  type OpsFlight,
} from "../operations/operationsData.ts";
import {
  FILTER_LABELS,
  FILTER_OPTIONS,
  VIEWS,
  type FilterDim,
  type ViewKey,
} from "../operations/opsFilters.ts";
import {
  areaMoveState,
  assignState,
  checkSwap,
  describePlan,
  describeShift,
  flightsAtStay,
  formatGap,
  occupancyById,
  offBoardStay,
  planAreaClosure,
  planAssign,
  planDrop,
  STAND_AREAS,
  stayName,
  stayOfFlight,
  suggestBest,
  type AreaMove,
  type DropPlan,
  type StandAssign,
} from "../operations/allocation.ts";
import type { Millis } from "../stand-timeline/index.ts";
import { utcAt } from "../stand-timeline-demo/adapter.ts";
import { DEMO_DATA, DEMO_DOMAIN, formatUtc } from "../stand-timeline-demo/demoData.ts";
import { SYNTHETIC_DATE, SYNTHETIC_STANDS } from "../stand-timeline-demo/syntheticFixture.ts";
import {
  DISRUPTION,
  explainPlan,
  formatHold,
  impactNow,
  planDisruption,
  rememberPlan,
  runsInto,
  type DisruptionPlan,
} from "../operations/disruption.ts";
import { movesLateStay, planFixAll, type AlertFix } from "../operations/priorities.ts";
import { briefing, nextUp } from "./briefing.ts";
import { callingNames, findPerson, guestNames, PEOPLE } from "./callGuests.ts";
import { injectionByteLength, MAX_INJECTION_BYTES } from "./liveEvents.ts";
import { flightLabel, type OperationsHost } from "./opsHost.ts";

export type AppAction =
  | { name: "find_flights"; query: string; direction: FlightDirection | null }
  | { name: "select_flight"; flightId: string }
  | { name: "select_flights"; flightIds: string[]; mode: SelectionMode }
  | { name: "clear_selection" }
  | { name: "set_view"; view: ViewKey }
  | { name: "set_filter"; dimension: FilterDim; values: string[] }
  | { name: "reset_filters" }
  | { name: "acknowledge_alert"; alertId: string }
  | { name: "unacknowledge_alert"; alertId: string }
  | { name: "describe_selection" }
  | { name: "list_alerts" }
  | { name: "list_conflicts" }
  /**
   * Getting going: a quick line on each open item, with an offer to take
   * them as one plan, which a yes carries out as fix_all (see ./briefing).
   */
  | { name: "brief" }
  | { name: "move_stay"; flightId: string; standId: string }
  /**
   * `stands` are where the two stays were when the request was understood,
   * so carrying it out is idempotent: once they have traded (by Skye's drag)
   * it is done, and a board that has moved on is refused, not swapped back.
   */
  | { name: "swap_stays"; flightIds: [string, string]; stands: [string, string] }
  | { name: "suggest_move"; flightId: string | null }
  /**
   * Closes a stand area from `from` to `to` and moves every stay on it then
   * to other stands, working on several at once (Skye's helper cursors).
   * The moves are planned when the request is understood, against the board
   * as it was; carrying them out is idempotent (see AreaMove).
   */
  | { name: "close_area"; area: string; from: Millis; to: Millis; moves: AreaMove[]; stuck: string[] }
  /**
   * Gives stands to flights that have none, keeping their stay times: onto
   * `standId` for one flight, or the first free stand that fits. `assigns`
   * (stays onto stands) and `unplaceable` (flights that cannot be placed,
   * each with why) are planned when the request is understood, against the
   * board as it was; carrying it out checks each again, so it is idempotent.
   */
  | {
      name: "assign_stands";
      flightIds: string[];
      standId: string | null;
      assigns: StandAssign[];
      unplaceable: Unplaceable[];
    }
  /**
   * Takes flights' stays off their stands, into the No stand lane. `stays` are
   * where they were when the request was understood, so carrying it out is
   * idempotent; `noStand` are the flights named that already had none.
   */
  | { name: "unassign_stands"; flightIds: string[]; stays: StandRelease[]; noStand: string[] }
  /**
   * Calls someone from the people list into the call, or takes them off it.
   * They only show on the call window: nothing reaches them.
   */
  | { name: "add_to_call"; person: string }
  | { name: "remove_from_call"; person: string }
  /**
   * Fixes everything at once ("all": the conflicts and the flights with no
   * stand) or every conflict ("conflicts"), with Skye's helper cursors working
   * together. Planned when the request is understood, against the board as
   * it was (see planFixAll); carrying it out checks each change again, so it
   * is idempotent. `left` are the open alerts it cannot clear, with why.
   */
  | {
      name: "fix_all";
      scope: "all" | "conflicts";
      moves: AreaMove[];
      assigns: StandAssign[];
      left: { alertId: string; reason: string }[];
      conflictsCleared: number;
    }
  /**
   * Clears a late flight's knock-on (the disruption demo; see
   * ../operations/disruption): weighs it across the plan, then moves the
   * stays it runs into, keeping the late aircraft on its stand, with Skye's
   * helper cursors. Planned when the request is understood (planDisruption);
   * carrying it out checks each move again, so it is idempotent.
   * `considered` are the stands looked at before each one chosen, and why
   * not, for Skye to show as she weighs it.
   */
  | {
      name: "resolve_disruption";
      flightId: string;
      stayId: string;
      moves: AreaMove[];
      stuck: string[];
      considered: DisruptionPlan["considered"];
    }
  /** Read-only: why Skye's plan for the disruption is what it is, and what it does to the board's figures. */
  | { name: "explain_plan" };

/** A flight `assign_stands` could not place, and why, in a sentence that names it. */
export type Unplaceable = { flightId: string; reason: string };

/** A stay to take off a stand, and the stand it was on. */
export type StandRelease = { stayId: string; standId: string };

export type AppActionName = AppAction["name"];

/**
 * How `select_flights` treats what is already selected: `replace` starts a
 * new selection, `add` keeps it and adds to it, as a Ctrl-click does.
 */
export type SelectionMode = "replace" | "add";

/**
 * `read` only inspects state, `write` changes it, `unsupported` exists purely
 * so a recognised-but-impossible request produces an honest answer.
 */
export type AppActionKind = "read" | "write" | "unsupported";

export const ACTION_KIND: Record<AppActionName, AppActionKind> = {
  find_flights: "read",
  describe_selection: "read",
  list_alerts: "read",
  list_conflicts: "read",
  // Only offers; doing it is a separate, confirmed request.
  brief: "read",
  select_flight: "write",
  select_flights: "write",
  clear_selection: "write",
  set_view: "write",
  set_filter: "write",
  reset_filters: "write",
  acknowledge_alert: "write",
  unacknowledge_alert: "write",
  move_stay: "write",
  swap_stays: "write",
  close_area: "write",
  assign_stands: "write",
  unassign_stands: "write",
  add_to_call: "write",
  remove_from_call: "write",
  fix_all: "write",
  resolve_disruption: "write",
  explain_plan: "read",
  // Only proposes; the move itself is a separate, confirmed request.
  suggest_move: "read",
};

export const APP_ACTION_NAMES = Object.keys(ACTION_KIND) as AppActionName[];

/**
 * Membership is tested against this set, not with `in`: `"constructor" in
 * ACTION_KIND` is true via Object.prototype, which would let an inherited
 * name past the allowlist and fall through the switch below.
 */
const ACTION_NAME_SET = new Set<string>(APP_ACTION_NAMES);

export function isAppActionName(value: unknown): value is AppActionName {
  return typeof value === "string" && ACTION_NAME_SET.has(value);
}

export type ValidationResult =
  | { ok: true; action: AppAction }
  | { ok: false; code: string; message: string };

export type ApplyResult =
  /**
   * `proposal` is an action offered but not taken (a suggested move), kept
   * in the task history so a confirmation ("yes, do it") can carry it out.
   * `cues` point at what the reply talks about, each when Skye says it;
   * `whileTalking` shows what it is about (the alerts) for as long as she is
   * talking about it. `withoutOffer` is the reply without the next thing it
   * offers, for when another offer has to take its place.
   */
  | {
      ok: true;
      spoken: string;
      mutated: boolean;
      proposal?: AppAction;
      cues?: SpeechCue[];
      whileTalking?: WhileTalking;
      withoutOffer?: string;
    }
  | { ok: false; code: string; message: string };

const VIEW_KEYS = VIEWS.map((view) => view.value);
const FILTER_DIMS = Object.keys(FILTER_LABELS) as FilterDim[];

/** Guards against an oversized filter request. */
const MAX_FILTER_VALUES = 12;
/** Guards against an oversized multi-selection; each flight is one click. */
export const MAX_SELECT_FLIGHTS = 12;

const reject = (code: string, message: string): ValidationResult => ({ ok: false, code, message });

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Validates one action name plus arguments.
 *
 * @param name Candidate action name; anything outside the allowlist is refused.
 * @param args Raw arguments, treated as untrusted.
 */
export function validateAppAction(name: unknown, args: Record<string, unknown> = {}): ValidationResult {
  const actionName = asString(name);
  if (!isAppActionName(actionName)) {
    return reject("unknown_action", `"${String(name)}" is not a Mica action.`);
  }
  // Arguments arrive from a model decision or a test; a prototype-polluted or
  // non-object value must not reach the per-action readers below.
  const safeArgs: Record<string, unknown> =
    args !== null && typeof args === "object" && !Array.isArray(args) ? args : {};

  switch (actionName) {
    case "find_flights": {
      const query = asString(safeArgs.query);
      if (!query) return reject("invalid_arguments", "find_flights needs a query.");
      const direction = asString(safeArgs.direction);
      if (direction !== null && direction !== "arrival" && direction !== "departure") {
        return reject("invalid_arguments", "direction must be arrival or departure.");
      }
      return { ok: true, action: { name: "find_flights", query: query.slice(0, 64), direction } };
    }
    case "select_flight": {
      const flightId = asString(safeArgs.flightId);
      if (!flightId) return reject("invalid_arguments", "select_flight needs a flightId.");
      if (!OPS_FLIGHTS_BY_ID.has(flightId)) {
        return reject("unknown_flight", `No flight with id ${flightId} in the demo data.`);
      }
      return { ok: true, action: { name: "select_flight", flightId } };
    }
    case "select_flights": {
      if (!Array.isArray(safeArgs.flightIds) || safeArgs.flightIds.length === 0) {
        return reject("invalid_arguments", "select_flights needs a non-empty flightIds array.");
      }
      if (safeArgs.flightIds.length > MAX_SELECT_FLIGHTS) {
        return reject("invalid_arguments", `select_flights accepts at most ${MAX_SELECT_FLIGHTS} flights.`);
      }
      const flightIds: string[] = [];
      for (const raw of safeArgs.flightIds) {
        const flightId = asString(raw);
        if (!flightId) return reject("invalid_arguments", "Flight ids must be non-empty strings.");
        if (!OPS_FLIGHTS_BY_ID.has(flightId)) {
          return reject("unknown_flight", `No flight with id ${flightId} in the demo data.`);
        }
        if (!flightIds.includes(flightId)) flightIds.push(flightId);
      }
      // Absent means a fresh selection, as a plain click makes.
      const mode = safeArgs.mode ?? "replace";
      if (mode !== "replace" && mode !== "add") return reject("invalid_arguments", "mode must be replace or add.");
      return { ok: true, action: { name: "select_flights", flightIds, mode } };
    }
    case "set_view": {
      const view = asString(safeArgs.view);
      if (!view || !VIEW_KEYS.includes(view as ViewKey)) {
        return reject("unknown_view", `View must be one of: ${VIEW_KEYS.join(", ")}.`);
      }
      return { ok: true, action: { name: "set_view", view: view as ViewKey } };
    }
    case "set_filter": {
      const dimension = asString(safeArgs.dimension);
      if (!dimension || !FILTER_DIMS.includes(dimension as FilterDim)) {
        return reject("unknown_filter", `Filter dimension must be one of: ${FILTER_DIMS.join(", ")}.`);
      }
      const dim = dimension as FilterDim;
      if (!Array.isArray(safeArgs.values)) return reject("invalid_arguments", "set_filter needs a values array.");
      if (safeArgs.values.length > MAX_FILTER_VALUES) {
        return reject("invalid_arguments", `set_filter accepts at most ${MAX_FILTER_VALUES} values.`);
      }
      const allowed = FILTER_OPTIONS[dim];
      const values: string[] = [];
      for (const raw of safeArgs.values) {
        const value = asString(raw);
        if (!value) return reject("invalid_arguments", "Filter values must be non-empty strings.");
        // Case-insensitive match onto the fixture's own spelling.
        const match = allowed.find((option) => option.toLowerCase() === value.toLowerCase());
        if (!match) {
          return reject(
            "unknown_filter_value",
            `"${value}" is not a ${FILTER_LABELS[dim]} value in the demo data.`,
          );
        }
        if (!values.includes(match)) values.push(match);
      }
      return { ok: true, action: { name: "set_filter", dimension: dim, values } };
    }
    case "acknowledge_alert":
    case "unacknowledge_alert": {
      const alertId = asString(safeArgs.alertId);
      if (!alertId) return reject("invalid_arguments", `${actionName} needs an alertId.`);
      if (!alertById(alertId)) return reject("unknown_alert", `No demo alert with id ${alertId} on the board now.`);
      return { ok: true, action: { name: actionName as "acknowledge_alert" | "unacknowledge_alert", alertId } };
    }
    case "move_stay": {
      const flight = chartFlight(safeArgs.flightId, "move_stay");
      if (!flight.ok) return flight;
      const standId = asString(safeArgs.standId);
      const stand = standId
        ? SYNTHETIC_STANDS.find((entry) => entry.code.toLowerCase() === standId.toLowerCase())
        : undefined;
      if (!stand) return reject("unknown_stand", `${standId ?? "That"} is not a stand on the chart.`);
      return { ok: true, action: { name: "move_stay", flightId: flight.flightId, standId: stand.code } };
    }
    case "swap_stays": {
      const ids = safeArgs.flightIds;
      if (!Array.isArray(ids) || ids.length !== 2) {
        return reject("invalid_arguments", "swap_stays needs exactly two flightIds.");
      }
      const a = chartFlight(ids[0], "swap_stays");
      if (!a.ok) return a;
      const b = chartFlight(ids[1], "swap_stays");
      if (!b.ok) return b;
      const stands: [string, string] = [a.standId, b.standId];
      return { ok: true, action: { name: "swap_stays", flightIds: [a.flightId, b.flightId], stands } };
    }
    case "suggest_move": {
      if (safeArgs.flightId == null) return { ok: true, action: { name: "suggest_move", flightId: null } };
      const flight = chartFlight(safeArgs.flightId, "suggest_move");
      if (!flight.ok) return flight;
      return { ok: true, action: { name: "suggest_move", flightId: flight.flightId } };
    }
    case "close_area": {
      const named = asString(safeArgs.area);
      const area = named ? matchArea(named) : undefined;
      if (!area) return reject("unknown_area", `The area must be one of: ${STAND_AREAS.join(", ")}.`);
      // Absent means the whole day on the chart.
      const from = safeArgs.from == null ? DEMO_DOMAIN[0] : clockTime(safeArgs.from);
      const to = safeArgs.to == null ? DEMO_DOMAIN[1] : clockTime(safeArgs.to);
      if (from === null || to === null) return reject("invalid_arguments", "from and to must be UTC times as HH:MM.");
      if (to <= from) return reject("invalid_arguments", "The closure must end after it starts.");
      const plan = planAreaClosure(area, from, to);
      return { ok: true, action: { name: "close_area", area, from, to, moves: plan.moves, stuck: plan.stuck } };
    }
    case "assign_stands": {
      const listed = flightList(safeArgs.flightIds, "assign_stands", true);
      if (!listed.ok) return listed;
      let standId: string | null = null;
      if (safeArgs.standId != null) {
        const named = asString(safeArgs.standId);
        const stand = named
          ? SYNTHETIC_STANDS.find((entry) => entry.code.toLowerCase() === named.toLowerCase())
          : undefined;
        if (!stand) return reject("unknown_stand", `${named ?? "That"} is not a stand on the chart.`);
        standId = stand.code;
      }
      // None named: every flight with no stand.
      return assignAction(
        listed.flights.length > 0 ? listed.flights : OPS_FLIGHTS.filter((flight) => !flight.standId),
        standId,
      );
    }
    case "unassign_stands": {
      const listed = flightList(safeArgs.flightIds, "unassign_stands", false);
      if (!listed.ok) return listed;
      const stays: StandRelease[] = [];
      const noStand: OpsFlight[] = [];
      for (const flight of listed.flights) {
        if (!flight.occupancyId || !flight.standId) noStand.push(flight);
        // An arrival and a departure at one stay come off together.
        else if (!stays.some((stay) => stay.stayId === flight.occupancyId)) {
          stays.push({ stayId: flight.occupancyId, standId: flight.standId });
        }
      }
      if (stays.length === 0) {
        return reject(
          "no_stand",
          `${listFlights(noStand)} ${noStand.length === 1 ? "has" : "have"} no stand already, so there is nothing to take off.`,
        );
      }
      return {
        ok: true,
        action: {
          name: "unassign_stands",
          flightIds: listed.flights.map((flight) => flight.id),
          stays,
          noStand: noStand.map((flight) => flight.id),
        },
      };
    }
    case "add_to_call":
    case "remove_from_call": {
      const said = asString(safeArgs.person);
      const person = said ? findPerson(said) : undefined;
      if (!person) {
        return reject("unknown_person", `${said ?? "That"} isn't someone I can call in. I can add ${listWords(PEOPLE)}.`);
      }
      const on = guestNames().includes(person);
      const calling = callingNames().includes(person);
      if (actionName === "add_to_call" && on) return reject("already_on_call", `${person} is on the call already.`);
      if (actionName === "add_to_call" && calling) return reject("already_on_call", `I'm calling ${person} already.`);
      if (actionName === "remove_from_call" && !on && !calling) return reject("not_on_call", `${person} isn't on the call.`);
      return { ok: true, action: { name: actionName, person } };
    }
    case "fix_all": {
      // Absent means everything.
      const scope = safeArgs.scope == null ? "all" : asString(safeArgs.scope);
      if (scope !== "all" && scope !== "conflicts") return reject("invalid_arguments", "scope must be all or conflicts.");
      const plan = planFixAll(currentAlerts(), scope);
      return { ok: true, action: { name: "fix_all", scope, ...plan } };
    }
    case "resolve_disruption": {
      // Absent means the flight the disruption is about.
      const flightId = safeArgs.flightId == null ? DISRUPTION.flightId : asString(safeArgs.flightId);
      const flight = flightId ? OPS_FLIGHTS_BY_ID.get(flightId) : undefined;
      if (!flight) return reject("unknown_flight", `No flight with id ${String(safeArgs.flightId)} in the demo data.`);
      const stay = stayOfFlight(flight);
      if (!stay) return reject("no_stand", `${flight.flight} has no stay on the chart.`);
      const delay = DEMO_DATA.delays.get(stay.id);
      if (!delay?.in && !delay?.out) return reject("not_late", `${flight.flight} is on time: there is nothing to resolve.`);
      if (runsInto(stay.id).length === 0) {
        return reject("no_conflict", `${stayName(stay)} is late, but it runs into nothing on ${stay.rowId}: there is nothing to resolve.`);
      }
      const plan = planDisruption(stay.id);
      return {
        ok: true,
        action: { name: "resolve_disruption", flightId: flight.id, stayId: stay.id, moves: plan.moves, stuck: plan.stuck, considered: plan.considered },
      };
    }
    case "explain_plan":
      return { ok: true, action: { name: "explain_plan" } };
    case "list_conflicts":
      return { ok: true, action: { name: "list_conflicts" } };
    case "brief":
      return { ok: true, action: { name: "brief" } };
    case "clear_selection":
      return { ok: true, action: { name: "clear_selection" } };
    case "reset_filters":
      return { ok: true, action: { name: "reset_filters" } };
    case "describe_selection":
      return { ok: true, action: { name: "describe_selection" } };
    case "list_alerts":
      return { ok: true, action: { name: "list_alerts" } };
  }

  // Total by construction: the switch covers every AppActionName and the name
  // was checked against the allowlist. Kept so that adding a name to the union
  // without a case here fails closed rather than returning undefined.
  return reject("unknown_action", `"${String(name)}" is not a Mica action.`);
}

/** A stand area by name: "Pier B", "pier b" or just "B"; "Remote" or "remote stands". */
function matchArea(name: string): string | undefined {
  const wanted = name.toLowerCase().replace(/\s+stands?$/, "").trim();
  return STAND_AREAS.find((area) => area.toLowerCase() === wanted || area.toLowerCase() === `pier ${wanted}`);
}

/** "09:00" on the demo date, or null when it is not a time of day. */
function clockTime(value: unknown): Millis | null {
  const match = typeof value === "string" ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return utcAt(SYNTHETIC_DATE, `${match[1].padStart(2, "0")}:${match[2]}`);
}

/** A flight id from the fixture whose flight has a stay on the chart, and where that stay is. */
function chartFlight(
  raw: unknown,
  name: string,
): { ok: true; flightId: string; standId: string } | { ok: false; code: string; message: string } {
  const flightId = asString(raw);
  if (!flightId) return { ok: false, code: "invalid_arguments", message: `${name} needs a flightId.` };
  const flight = OPS_FLIGHTS_BY_ID.get(flightId);
  if (!flight) return { ok: false, code: "unknown_flight", message: `No flight with id ${flightId} in the demo data.` };
  const stay = stayOfFlight(flight);
  if (!stay) {
    return {
      ok: false,
      code: "no_stand",
      message: `${flight.flight} has no stand, so it has no stay on the chart to move. I can give it a stand instead.`,
    };
  }
  return { ok: true, flightId, standId: stay.rowId };
}

/**
 * Flights by id from the fixture, without repeats. Absent or empty is
 * allowed only when `optional`, and then gives no flights.
 */
function flightList(
  raw: unknown,
  name: string,
  optional: boolean,
): { ok: true; flights: OpsFlight[] } | { ok: false; code: string; message: string } {
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) {
    return optional
      ? { ok: true, flights: [] }
      : { ok: false, code: "invalid_arguments", message: `${name} needs a non-empty flightIds array.` };
  }
  if (!Array.isArray(raw)) return { ok: false, code: "invalid_arguments", message: `${name} needs a flightIds array.` };
  if (raw.length > MAX_SELECT_FLIGHTS) {
    return { ok: false, code: "invalid_arguments", message: `${name} accepts at most ${MAX_SELECT_FLIGHTS} flights.` };
  }
  const flights: OpsFlight[] = [];
  for (const entry of raw) {
    const flightId = asString(entry);
    if (!flightId) return { ok: false, code: "invalid_arguments", message: "Flight ids must be non-empty strings." };
    const flight = OPS_FLIGHTS_BY_ID.get(flightId);
    if (!flight) return { ok: false, code: "unknown_flight", message: `No flight with id ${flightId} in the demo data.` };
    if (!flights.includes(flight)) flights.push(flight);
  }
  return { ok: true, flights };
}

/**
 * `assign_stands` for `flights`: their stays planned onto stands under the
 * sample rules, and why each of the rest cannot be placed.
 */
function assignAction(flights: readonly OpsFlight[], standId: string | null): ValidationResult {
  const stayIds: string[] = [];
  const unplaceable: Unplaceable[] = [];
  for (const flight of flights) {
    if (flight.standId) {
      unplaceable.push({ flightId: flight.id, reason: `${flight.flight} is already on ${flight.standId}; I can move it instead.` });
    } else if (!flight.unplacedStay) {
      unplaceable.push({
        flightId: flight.id,
        reason: `${flight.flight} has no stay times in the demo data, so there is nothing to place.`,
      });
    } else if (!stayIds.includes(flight.unplacedStay.stayId)) {
      // An arrival and a departure at one stay get their stand together.
      stayIds.push(flight.unplacedStay.stayId);
    }
  }
  if (standId && stayIds.length > 1) {
    return reject("invalid_arguments", "Name one flight to put on a particular stand.");
  }
  const plan = planAssign(stayIds, standId ?? undefined);
  for (const entry of plan.unplaceable) {
    const flight = flightsAtStay(entry.stayId)[0];
    if (flight) unplaceable.push({ flightId: flight.id, reason: entry.reason });
  }
  const order = (entry: Unplaceable) => flights.findIndex((flight) => flight.id === entry.flightId);
  return {
    ok: true,
    action: {
      name: "assign_stands",
      flightIds: flights.map((flight) => flight.id),
      standId,
      assigns: plan.assigns,
      unplaceable: unplaceable.sort((a, b) => order(a) - order(b)),
    },
  };
}

/* ------------------------------------------------------------- read helpers */

/**
 * A search for the flights with no stand, however it is put: "unassigned",
 * "no stand", "flights without a stand", "needs a stand". Those flights have
 * no field to match against, so without this such a search finds nothing and
 * Skye would say there are none while they wait in the No stand lane.
 */
const NO_STAND_QUERY =
  /\b(unassigned|un-?allocated|no[- ]?stands?|without (a )?stands?|stand-?less|(needs?|needing|missing|waiting for) (a )?stands?)\b/;

/** Whether a find_flights query asks for the flights with no stand. */
export const isNoStandQuery = (query: string) => NO_STAND_QUERY.test(query.toLowerCase());

function searchFlights(query: string, direction: FlightDirection | null): OpsFlight[] {
  if (isNoStandQuery(query)) {
    return OPS_FLIGHTS.filter((flight) => !flight.standId && (!direction || flight.direction === direction)).sort(
      (a, b) => a.estimate - b.estimate,
    );
  }
  const needle = query.toLowerCase().replace(/\s+/g, "");
  return OPS_FLIGHTS.filter((flight) => {
    if (direction && flight.direction !== direction) return false;
    return (
      flight.flight.toLowerCase().includes(needle) ||
      flight.routeEnd.toLowerCase().includes(needle) ||
      (flight.standId?.toLowerCase() === needle) ||
      (flight.registration?.toLowerCase().includes(needle) ?? false) ||
      (flight.aircraftType?.toLowerCase() === needle)
    );
  });
}

/** A demo-only reminder, said with every stand change. */
const SAMPLE_RULES = "It's a demo change, checked only for overlaps and the sample stand sizes.";

/** The action that carries out a planned move or swap, named by flights. */
function proposalFor(plan: Extract<DropPlan, { kind: "move" } | { kind: "swap" }>): AppAction | undefined {
  const flightAt = (occupancyId: string) => OPS_FLIGHTS.find((flight) => flight.occupancyId === occupancyId);
  const a = flightAt(plan.occupancyId);
  if (!a?.standId) return undefined;
  if (plan.kind === "move") return { name: "move_stay", flightId: a.id, standId: plan.standId };
  const b = flightAt(plan.otherId);
  return b?.standId ? { name: "swap_stays", flightIds: [a.id, b.id], stands: [a.standId, b.standId] } : undefined;
}

/** "a, b and c". */
const listWords = (words: readonly string[]) =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/** "XD456/457 to C25", "XC338/339 to C24, 15m later". */
function describeAreaMove(move: AreaMove): string {
  const occupancy = occupancyById(move.occupancyId);
  const name = occupancy ? stayName(occupancy) : move.occupancyId;
  return `${name} to ${move.standId}${move.shiftMs ? `, ${describeShift(move.shiftMs)}` : ""}`;
}

/** "XD456/457 on B12", for a stay still where it was. */
function stayOn(occupancyId: string): string {
  const occupancy = occupancyById(occupancyId);
  return occupancy ? `${stayName(occupancy)} on ${occupancy.rowId}` : occupancyId;
}

/** A stay's flights, e.g. "XA101/102" or "XB240", whether it has a stand or not. */
function stayLabel(stayId: string): string {
  const stay = occupancyById(stayId) ?? offBoardStay(stayId);
  return stay ? stayName(stay) : stayId;
}

/** "one", or the number, for "I couldn't place one" / "I couldn't place 3". */
const countWord = (count: number) => (count === 1 ? "one" : String(count));

/**
 * What `assign_stands` did, said: what went where, then each reason a flight
 * could not be placed, in full. When that is too long to say, the placed
 * flights are counted rather than named, so the reasons are never cut.
 */
function describeAssignments(placed: readonly StandAssign[], left: readonly Unplaceable[], asked: number): string {
  if (asked === 0) return "Every flight has a stand already, so there was nothing to place.";
  const couldNot =
    left.length === 0
      ? ""
      : `I couldn't place ${placed.length === 0 && left.length > 1 ? "any of them" : countWord(left.length)}: ${left.map((entry) => entry.reason).join(" ")}`;
  const rules = placed.length > 0 ? " Demo changes, checked only for overlaps, stand sizes and closures." : "";
  const say = (placedText: string) => [placedText, couldNot].filter(Boolean).join(" ") + rules;
  if (placed.length === 0) return say("");
  const named = say(`Placed ${listWords(placed.map((assign) => `${stayLabel(assign.stayId)} on ${assign.standId}`))}.`);
  return injectionByteLength(named) <= MAX_INJECTION_BYTES
    ? named
    : say(`Placed ${placed.length} flight${placed.length === 1 ? "" : "s"}; they're highlighted on the chart.`);
}

/** "XA101, XB240 and XC118": flight numbers, with the direction when a code is both legs. */
function listFlights(flights: readonly OpsFlight[]): string {
  const names = flights.map((flight) =>
    OPS_FLIGHTS.some((other) => other !== flight && other.flight === flight.flight)
      ? `${flight.flight} ${flight.direction}`
      : flight.flight,
  );
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/* ----------------------------------------------------------------- applying */

/**
 * Something a reply talks about, to point at as Skye says it: `words` are
 * what she would say for it (its flight numbers, "the A1 conflict"), and
 * `show` selects it. A cue only fires when one of its words is heard, so
 * nothing is selected while she is still going over other things.
 */
export type SpeechCue = { words: readonly string[]; show: () => void };

/** Shown while Skye talks about it: `start` as she begins, `end` once she has gone quiet. */
export type WhileTalking = { start: () => void; end: () => void };

/** The alerts, in Skye's compact window, for as long as she talks about them. */
const alertsWhileTalking = (host: OperationsHost): WhileTalking => ({
  start: () => host.showAlerts(null),
  end: () => host.hideAlerts(),
});

/**
 * A cue for one alert: the stays of a conflict selected together on the
 * chart (the late one and the ones it runs into), or a flight with no stand
 * picked by its bar in the No stand lane. None for a notice.
 */
function alertCue(alert: OpsAlert, host: OperationsHost): SpeechCue | null {
  if (alert.kind === "conflict" && alert.conflict) {
    const stays = [alert.conflict.stayId, ...alert.conflict.intoIds];
    const flights = stays.flatMap((stayId) => flightsAtStay(stayId));
    const selectable = [...new Set(stays.flatMap((stayId) => flightsAtStay(stayId)[0]?.id ?? []))].slice(0, MAX_SELECT_FLIGHTS);
    return {
      words: [`${alert.conflict.standId} conflict`, `conflict on ${alert.conflict.standId}`, ...flights.map((flight) => flight.flight)],
      // Its stays on the board, and the alert itself in the compact list.
      show: () => {
        host.selectFlights(selectable, "replace");
        host.showAlerts(alert.id);
      },
    };
  }
  const flight = alert.kind === "no_stand" ? OPS_FLIGHTS_BY_ID.get(alert.flightId) : undefined;
  return flight
    ? {
        words: [flight.flight],
        show: () => {
          host.selectFlight(flight.id);
          host.showAlerts(alert.id);
        },
      }
    : null;
}

/** Cues for each alert a reply talks about, in the order it does. */
const alertCues = (alerts: readonly OpsAlert[], host: OperationsHost): SpeechCue[] =>
  alerts.flatMap((alert) => alertCue(alert, host) ?? []);

/** The action that carries out a suggested fix, validated like any request. */
function fixAction(fix: AlertFix): AppAction | undefined {
  const validated =
    fix.kind === "move"
      ? validateAppAction("move_stay", { flightId: fix.flightId, standId: fix.standId })
      : fix.kind === "knock_on"
        ? validateAppAction("resolve_disruption", { flightId: fix.flightId })
        : validateAppAction("assign_stands", { flightIds: [fix.flightId], standId: fix.standId });
  return validated.ok ? validated.action : undefined;
}

/** Stand changes that can clear an alert, after which the next thing to do is offered. */
const CLEARS_ALERTS = new Set<AppActionName>(["move_stay", "swap_stays", "assign_stands", "close_area", "resolve_disruption"]);

/** The open alerts that ask for something (not notices), as they are now. */
export const openWork = (host: OperationsHost): OpsAlert[] =>
  host
    .snapshot()
    .openAlerts.filter((alert) => alert.kind !== "notice")
    .flatMap((alert) => alertById(alert.id) ?? []);

/**
 * Runs a validated action against the host. Identifiers are re-checked here:
 * between validation and application the user may have changed the board, and
 * a result must never be applied to something that no longer exists.
 *
 * A stand change that clears an open conflict, or gives a waiting flight its
 * stand, says so and offers the next thing to do, so open items can be worked
 * through one at a time with a yes each.
 */
export function applyAppAction(
  action: AppAction,
  host: OperationsHost,
  /**
   * The open work before the request began. Skye's cursor makes the change
   * on screen before this runs, so the executor reads it first; without it,
   * the board as it is now.
   */
  openBefore: readonly OpsAlert[] = openWork(host),
): ApplyResult {
  if (!CLEARS_ALERTS.has(action.name)) return applyAction(action, host);
  const before = openBefore;
  const result = applyAction(action, host);
  if (!result.ok || !result.mutated || result.proposal) return result;
  const after = new Set(openWork(host).map((alert) => alert.id));
  const cleared = before.filter((alert) => !after.has(alert.id));
  if (cleared.length === 0) return result;
  const conflicts = cleared.filter((alert) => alert.kind === "conflict").map((alert) => alert.conflict?.standId ?? "");
  // Clearing a disruption says what it cleared already, as gate hold.
  const clearedText =
    conflicts.length > 0 && action.name !== "resolve_disruption"
      ? ` That clears the ${listWords(conflicts)} conflict${conflicts.length === 1 ? "" : "s"}.`
      : "";
  const next = nextUp(openWork(host));
  const proposal = next ? fixAction(next.fix) : undefined;
  const spoken = `${result.spoken}${clearedText}${next && proposal ? ` ${next.spoken}` : ""}`;
  // The offer only goes on when it fits in what Skye can be told to say.
  if (injectionByteLength(spoken) > MAX_INJECTION_BYTES) return { ...result, spoken: `${result.spoken}${clearedText}` };
  // Pointing at what is offered next as Skye says it.
  const cues = next && proposal ? alertCues([next.alert], host) : [];
  const whileTalking = cues.length > 0 ? alertsWhileTalking(host) : undefined;
  return proposal
    ? { ...result, spoken, proposal, cues, whileTalking, withoutOffer: `${result.spoken}${clearedText}` }
    : { ...result, spoken, cues, whileTalking };
}

function applyAction(action: AppAction, host: OperationsHost): ApplyResult {
  switch (action.name) {
    case "find_flights": {
      const matches = searchFlights(action.query, action.direction);
      if (isNoStandQuery(action.query)) {
        if (matches.length === 0) return { ok: true, spoken: "Every flight has a stand.", mutated: false };
        // When each needs a stand, or that it has no times yet.
        const needs = (flight: OpsFlight) =>
          flight.unplacedStay
            ? `${flight.flight} ${formatUtc(flight.unplacedStay.start)}–${formatUtc(flight.unplacedStay.end)}`
            : `${flight.flight}, no stay times yet`;
        const named = matches.slice(0, 6);
        return {
          ok: true,
          spoken:
            `${matches.length === 1 ? "One flight has" : `${matches.length} flights have`} no stand: ` +
            `${named.map(needs).join("; ")}${matches.length > named.length ? `; and ${matches.length - named.length} more` : ""}. ` +
            "I can give them stands.",
          mutated: false,
          // Each picked in the No stand lane as Skye names it: waiting flights are not selected together.
          cues: named.map((flight) => ({ words: [flight.flight], show: () => host.selectFlight(flight.id) })),
        };
      }
      if (matches.length === 0) {
        return { ok: true, spoken: `No flight in the demo data matches ${action.query}.`, mutated: false };
      }
      const shown = matches.slice(0, 5).map(flightLabel).join("; ");
      return {
        ok: true,
        spoken:
          matches.length > 5
            ? `${matches.length} matches, first five: ${shown}.`
            : `${matches.length === 1 ? "One match" : `${matches.length} matches`}: ${shown}.`,
        mutated: false,
      };
    }
    case "select_flight": {
      const flight = OPS_FLIGHTS_BY_ID.get(action.flightId);
      if (!flight) return { ok: false, code: "unknown_flight", message: "That flight is no longer in the data." };
      host.selectFlight(action.flightId);
      const minutes = standMinutes(flight);
      return {
        ok: true,
        spoken: flight.standId
          ? `Selected ${flight.flight}, ${flight.direction} on stand ${flight.standId}` +
            `${minutes === null ? "" : `, which it holds for ${formatDuration(minutes)}`}.`
          : flight.unplacedStay
            ? `Selected ${flight.flight}. It has no stand yet, so it's waiting in the No stand row at the top of the board.` +
              ` It needs one ${formatUtc(flight.unplacedStay.start)}–${formatUtc(flight.unplacedStay.end)} UTC.`
            : `Selected ${flight.flight}. It has no stand, and no stay times yet, so it isn't on the board.`,
        mutated: true,
      };
    }
    case "select_flights": {
      const flights = action.flightIds.map((id) => OPS_FLIGHTS_BY_ID.get(id));
      if (flights.some((flight) => !flight)) {
        return { ok: false, code: "unknown_flight", message: "One of those flights is no longer in the data." };
      }
      const resolved = flights as OpsFlight[];
      // One flight in place of the selection is a plain selection, with its details.
      if (action.mode === "replace" && resolved.length === 1) {
        return applyAppAction({ name: "select_flight", flightId: resolved[0].id }, host);
      }
      // Several flights are selected together on the stands, so a flight with
      // no stand, whose bar waits in the No stand lane, cannot be one of them.
      const onChart = resolved.filter((flight) => flight.occupancyId);
      const offChart = resolved.filter((flight) => !flight.occupancyId);
      if (onChart.length === 0) {
        return {
          ok: false,
          code: "not_on_chart",
          message: `${listFlights(offChart)} ${offChart.length === 1 ? "has" : "have"} no stand, so ${offChart.length === 1 ? "it" : "they"} cannot be selected together with flights on stands. I can select one on its own.`,
        };
      }
      host.selectFlights(
        onChart.map((flight) => flight.id),
        action.mode,
      );
      const total = host.snapshot().selection.occupancyIds.length;
      const left =
        offChart.length === 0
          ? ""
          : ` ${listFlights(offChart)} ${offChart.length === 1 ? "has" : "have"} no stand, so ${offChart.length === 1 ? "it was" : "they were"} left out.`;
      return {
        ok: true,
        spoken:
          `${action.mode === "add" ? "Added" : "Selected"} ${listFlights(onChart)}` +
          `${action.mode === "add" ? `, ${total} stay${total === 1 ? "" : "s"} selected in all` : ""}.${left}`,
        mutated: true,
      };
    }
    case "clear_selection":
      host.clearSelection();
      return { ok: true, spoken: "Cleared the selection.", mutated: true };
    case "set_view": {
      host.setView(action.view);
      const label = VIEWS.find((view) => view.value === action.view)?.label ?? action.view;
      const after = host.snapshot();
      return {
        ok: true,
        spoken: `Showing ${label}: ${after.matchingFlights} of ${after.totalFlights} flights.`,
        mutated: true,
      };
    }
    case "set_filter": {
      host.setFilter(action.dimension, action.values);
      const after = host.snapshot();
      const label = FILTER_LABELS[action.dimension];
      return {
        ok: true,
        spoken:
          action.values.length === 0
            ? `Cleared the ${label} filter: ${after.matchingFlights} flights match.`
            : `Filtered ${label} to ${action.values.join(", ")}: ${after.matchingFlights} of ${after.totalFlights} flights match.`,
        mutated: true,
      };
    }
    case "reset_filters":
      host.resetFilters();
      return { ok: true, spoken: "Reset all filters.", mutated: true };
    case "acknowledge_alert":
    case "unacknowledge_alert": {
      const alert = alertById(action.alertId);
      if (!alert) return { ok: false, code: "unknown_alert", message: "That alert has cleared: it is no longer on the board." };
      const acknowledge = action.name === "acknowledge_alert";
      host.setAcknowledged(action.alertId, acknowledge);
      return {
        ok: true,
        spoken: `${acknowledge ? "Acknowledged" : "Reopened"} the demo alert "${alert.title}".`,
        mutated: true,
      };
    }
    case "describe_selection": {
      const snapshot = host.snapshot();
      if (snapshot.selection.flightNumber) {
        return {
          ok: true,
          spoken: snapshot.selection.standId
            ? `${snapshot.selection.flightNumber} is selected, on stand ${snapshot.selection.standId}.`
            : `${snapshot.selection.flightNumber} is selected and has no stand.`,
          mutated: false,
        };
      }
      const onChart = snapshot.selection.flights;
      if (onChart.length > 0) {
        // Named rather than counted: "two stays are selected" is useless when
        // the user asked which flight they are looking at.
        return {
          ok: true,
          spoken:
            `${snapshot.selection.occupancyIds.length} chart stay${snapshot.selection.occupancyIds.length === 1 ? "" : "s"} selected: ` +
            `${onChart
              .slice(0, 4)
              .map((entry) => `${entry.flight} ${entry.direction}`)
              .join(", ")}${onChart.length > 4 ? ", and more" : ""}.`,
          mutated: false,
        };
      }
      if (snapshot.selection.occupancyIds.length > 0) {
        return {
          ok: true,
          spoken: `${snapshot.selection.occupancyIds.length} chart stays are selected, with no flight at them.`,
          mutated: false,
        };
      }
      return { ok: true, spoken: "Nothing is selected right now.", mutated: false };
    }
    case "list_alerts": {
      // Every open alert, grouped, rather than the first few titles: a flight
      // left unread is a flight the user never hears about.
      const open = host.snapshot().openAlerts;
      if (open.length === 0) {
        return { ok: true, spoken: "There are no open demo alerts.", mutated: false };
      }
      const of = (kind: AlertKind) => open.filter((alert) => alert.kind === kind);
      const noStand = of("no_stand").flatMap((alert) => OPS_FLIGHTS_BY_ID.get(alert.flightId) ?? []);
      const conflicts = of("conflict").map((alert) => alert.title);
      const notices = of("notice").map((alert) => alert.title);
      const parts = [`${open.length} open demo alert${open.length === 1 ? "" : "s"}.`];
      if (noStand.length > 0) {
        const named = noStand.slice(0, 8);
        parts.push(
          `${noStand.length === 1 ? "One flight has" : `${noStand.length} flights have`} no stand: ` +
            `${listFlights(named)}${noStand.length > named.length ? `, and ${noStand.length - named.length} more` : ""}.`,
        );
      }
      if (conflicts.length > 0) {
        parts.push(`${conflicts.length === 1 ? "One conflict" : `${conflicts.length} conflicts`}: ${conflicts.join("; ")}.`);
      }
      if (notices.length > 0) {
        parts.push(`${notices.length === 1 ? "One notice" : `${notices.length} notices`}: ${notices.join("; ")}.`);
      }
      // Each named alert selected as Skye gets to it.
      const cues = alertCues(open.flatMap((alert) => alertById(alert.id) ?? []), host);
      return { ok: true, spoken: parts.join(" "), mutated: false, cues, whileTalking: alertsWhileTalking(host) };
    }
    case "fix_all": {
      // Skye's helpers have usually made most of these already; the rest are
      // checked against the board as it is now before they land.
      const plans: Extract<DropPlan, { kind: "move" }>[] = [];
      const done: string[] = [];
      const landed: AreaMove[] = [];
      for (const move of action.moves) {
        const state = areaMoveState(move);
        const plan = state === "pending" ? planDrop(move.occupancyId, move.standId) : null;
        if (state === "done") done.push(move.occupancyId);
        else if (plan?.kind === "move") plans.push(plan);
        else continue;
        landed.push(move);
      }
      const assigns = action.assigns.filter((assign) => assignState(assign) !== "moved");
      host.applyFixes(plans, assigns, [...done, ...plans.map((plan) => plan.occupancyId), ...assigns.map((assign) => assign.stayId)]);
      const placed = action.assigns.filter((assign) => assignState(assign) === "done").length;
      // Planned, but changed by someone before it could land.
      const changed = action.moves.length - landed.length + (action.assigns.length - placed);
      const conflictsLeft = currentAlerts().some((alert) => alert.kind === "conflict");
      // Conflicts, not moves: clearing a late stay's knock-on can take several.
      const planned = action.conflictsCleared + action.left.filter((entry) => entry.alertId.startsWith("ALERT-CLASH")).length;
      const cleared =
        landed.length === 0 ? 0 : Math.max(0, planned - currentAlerts().filter((alert) => alert.kind === "conflict").length);
      // The outcome in one short sentence, so Skye gets to the approval
      // quickly; every move is listed in Outputs.
      const what = [
        cleared > 0 && !movesLateStay(landed) && "the late aircraft stayed put",
        cleared > 0 &&
          (cleared === 1 ? "one conflict is clear" : cleared === 2 && !conflictsLeft ? "both conflicts are clear" : `${cleared} conflicts are clear`),
        placed > 0 && (placed === 1 ? "one flight has a stand" : `${placed} flights have stands`),
      ].filter((part): part is string => !!part);
      const stillOpen = action.left.map((entry) => entry.reason);
      // What it couldn't do, named only: the rundown said why.
      const leftNames = action.left.flatMap((entry) => {
        const alert = alertById(entry.alertId);
        if (alert?.kind === "conflict") return [`the ${alert.conflict?.standId ?? ""} conflict`];
        return alert?.kind === "no_stand" ? [OPS_FLIGHTS_BY_ID.get(alert.flightId)?.flight ?? alert.flightId] : [];
      });
      if (what.length === 0) {
        return {
          ok: true,
          spoken:
            action.moves.length + action.assigns.length === 0
              ? `Nothing I can fix${stillOpen.length > 0 ? `: ${stillOpen.join(" ")}` : ": there are no conflicts or flights waiting for a stand."}`
              : "The board changed since you asked, so I left it. Ask me again.",
          mutated: false,
        };
      }
      const spoken =
        `Done: ${listWords(what)}.` +
        (changed > 0 ? ` ${changed === 1 ? "One" : changed} had changed since you asked, so I left ${changed === 1 ? "it" : "them"}.` : "") +
        (leftNames.length > 0 ? ` ${listWords(leftNames)} ${leftNames.length === 1 ? "is" : "are"} still open.` : "") +
        " The details are in Outputs.";
      return { ok: true, spoken, mutated: true };
    }
    case "resolve_disruption": {
      // Skye's helpers have usually made these already; the rest are checked
      // against the board as it is now before they land.
      const plans: Extract<DropPlan, { kind: "move" }>[] = [];
      const landed: AreaMove[] = [];
      for (const move of action.moves) {
        const state = areaMoveState(move);
        const plan = state === "pending" ? planDrop(move.occupancyId, move.standId) : null;
        if (plan?.kind === "move") plans.push(plan);
        else if (state !== "done") continue;
        landed.push(move);
      }
      // The late stay shows with what moved: what kept its stand and what made way.
      host.applyFixes(plans, [], landed.length > 0 ? [action.stayId, ...landed.map((move) => move.occupancyId)] : []);
      rememberPlan(action);
      const late = occupancyById(action.stayId);
      const lateName = late ? stayName(late) : (OPS_FLIGHTS_BY_ID.get(action.flightId)?.flight ?? action.flightId);
      if (landed.length === 0) {
        return {
          ok: true,
          spoken:
            action.moves.length === 0
              ? `${lateName} runs into ${listWords(action.stuck.map(stayLabel))}, and no stand that fits is free for ${action.stuck.length === 1 ? "it" : "them"}. It needs a person's call.`
              : "The board changed since you asked, so I left it. Ask me again.",
          mutated: false,
        };
      }
      // One sentence, so Skye gets to the approval quickly: what moved is on
      // the board and in Outputs, so it is counted, not listed.
      const impact = impactNow();
      const moved = landed.length === 1 ? `${stayLabel(landed[0].occupancyId)} moves` : `${landed.length} flights move`;
      const figures =
        impact && impact.gateHold.before !== impact.gateHold.after
          ? `, so gate hold is down from ${formatHold(impact.gateHold.before)} to ${formatHold(impact.gateHold.after)}`
          : "";
      const stuck =
        action.stuck.length > 0 ? ` ${listWords(action.stuck.map(stayLabel))} still ${action.stuck.length === 1 ? "has" : "have"} no stand that fits.` : "";
      return {
        ok: true,
        spoken: `Done: ${lateName} keeps ${late?.rowId ?? "its stand"} and ${moved}${figures}.${stuck}`,
        mutated: true,
      };
    }
    case "explain_plan":
      return { ok: true, spoken: explainPlan(), mutated: false };
    case "add_to_call": {
      host.addToCall(action.person);
      return { ok: true, spoken: `Calling ${action.person} now.`, mutated: true };
    }
    case "remove_from_call": {
      // Someone still ringing has their call stopped rather than being taken off.
      const calling = callingNames().includes(action.person);
      host.removeFromCall(action.person);
      const spoken = calling ? `Stopped calling ${action.person}.` : `Took ${action.person} off the call.`;
      return { ok: true, spoken, mutated: true };
    }
    case "brief": {
      const open = host
        .snapshot()
        .openAlerts.flatMap((alert) => alertById(alert.id) ?? []);
      const { spoken, offersPlan, mentioned } = briefing(open);
      // A yes plans it all again, against the board as it is then.
      const validated = offersPlan ? validateAppAction("fix_all", { scope: "all" }) : undefined;
      const proposal = validated?.ok ? validated.action : undefined;
      // Each thing it names, selected as Skye gets to it; not during the summary before.
      const cues = alertCues(mentioned, host);
      // The alerts, compact, while Skye goes over them.
      const whileTalking = open.length > 0 ? alertsWhileTalking(host) : undefined;
      return proposal
        ? { ok: true, spoken, mutated: false, proposal, cues, whileTalking }
        : { ok: true, spoken, mutated: false, cues, whileTalking };
    }
    case "list_conflicts": {
      // Every conflict on the board, acknowledged or not: they are facts
      // about the stays, not just open items.
      const conflicts = currentAlerts().filter((alert) => alert.kind === "conflict");
      if (conflicts.length === 0) {
        return { ok: true, spoken: "No conflicts on the board: no late stay runs into another stay.", mutated: false };
      }
      return {
        ok: true,
        spoken:
          `${conflicts.length === 1 ? "One conflict" : `${conflicts.length} conflicts`}, from late stays: ` +
          `${conflicts.map((alert) => alert.title).join("; ")}. Moving or unassigning one of those stays clears it.`,
        mutated: false,
        // Each conflict's stays, selected as Skye gets to it, with the alerts showing.
        cues: alertCues(conflicts, host),
        whileTalking: alertsWhileTalking(host),
      };
    }
    case "move_stay": {
      const occupancy = stayOfFlight(OPS_FLIGHTS_BY_ID.get(action.flightId));
      if (!occupancy) return { ok: false, code: "no_stand", message: "That flight no longer has a stay on the chart." };
      const plan = planDrop(occupancy.id, action.standId);
      if (plan.kind === "stay") {
        // Also where Skye's drag on screen already made the move.
        return { ok: true, spoken: `${stayName(occupancy)} is on ${action.standId}. ${SAMPLE_RULES}`, mutated: true };
      }
      if (plan.kind === "swap") {
        const other = OPS_FLIGHTS.find((flight) => flight.occupancyId === plan.otherId);
        return {
          ok: false,
          code: "needs_swap",
          message: `${stayName(occupancy)} would overlap ${other?.flight ?? "another stay"} on ${action.standId}. I can swap the two instead.`,
        };
      }
      if (plan.kind === "conflict") return { ok: false, code: "conflict", message: `I can't: ${plan.reason}` };
      const from = occupancy.rowId;
      host.applyStandPlan(plan);
      return {
        ok: true,
        spoken: `Moved ${stayName(occupancy)} from ${from} to ${action.standId}. ${SAMPLE_RULES}`,
        mutated: true,
      };
    }
    case "swap_stays": {
      const [a, b] = action.flightIds.map((id) => stayOfFlight(OPS_FLIGHTS_BY_ID.get(id)));
      if (!a || !b) return { ok: false, code: "no_stand", message: "One of those flights no longer has a stay on the chart." };
      const [aWas, bWas] = action.stands;
      const swapped = `Swapped them: ${stayName(a)} is on ${bWas} and ${stayName(b)} on ${aWas}. ${SAMPLE_RULES}`;
      // Already traded, by Skye's drag on screen.
      if (a.rowId === bWas && b.rowId === aWas) return { ok: true, spoken: swapped, mutated: true };
      if (a.rowId !== aWas || b.rowId !== bWas) {
        return { ok: false, code: "board_moved", message: "Those stays have moved since you asked, so I left them. Ask me again." };
      }
      const check = checkSwap(a.id, b.id);
      if (!check.ok) return { ok: false, code: "conflict", message: `I can't swap them: ${check.reason}` };
      host.applyStandPlan({ kind: "swap", occupancyId: a.id, otherId: b.id });
      return { ok: true, spoken: swapped, mutated: true };
    }
    case "suggest_move": {
      const occupancy = action.flightId ? stayOfFlight(OPS_FLIGHTS_BY_ID.get(action.flightId)) : undefined;
      const best = suggestBest(occupancy?.id);
      const proposal = best ? proposalFor(best.plan) : undefined;
      if (!best || !proposal) {
        return {
          ok: true,
          spoken: occupancy
            ? `I can't find a move or swap for ${stayName(occupancy)} that widens the tightest gap between stays.`
            : "I can't find a move or swap that widens the tightest gap between stays.",
          mutated: false,
        };
      }
      const [first, second] = best.stands;
      return {
        ok: true,
        spoken:
          `Best I can find: ${describePlan(best.plan)}. That takes the tightest gap between stays on ${first} and ${second} ` +
          `from ${formatGap(best.before)} to ${formatGap(best.after)}. It only checks overlaps and the sample stand sizes. ` +
          "Want me to do it?",
        mutated: false,
        proposal,
      };
    }
    case "close_area": {
      const window = `${action.area} ${formatUtc(action.from)}–${formatUtc(action.to)}`;
      // Skye's cursors have usually moved most of these already; the rest
      // are checked against the board as it is now before they move.
      const plans: Extract<DropPlan, { kind: "move" }>[] = [];
      const left: AreaMove[] = [];
      for (const move of action.moves) {
        const state = areaMoveState(move);
        if (state === "done") continue;
        const plan = state === "pending" ? planDrop(move.occupancyId, move.standId, move.shiftMs) : null;
        if (plan?.kind === "move") plans.push(plan);
        else left.push(move);
      }
      const moved = action.moves.filter((move) => !left.includes(move));
      host.closeArea(
        { area: action.area, from: action.from, to: action.to },
        plans,
        moved.map((move) => move.occupancyId),
      );
      if (action.moves.length === 0 && action.stuck.length === 0) {
        return { ok: true, spoken: `Closed ${window}. Nothing was on it then, so nothing had to move.`, mutated: true };
      }
      // Held stays first: they are the ones the user most needs to hear about.
      const held = moved.filter((move) => move.shiftMs !== 0);
      const named = [...held, ...moved.filter((move) => move.shiftMs === 0)].slice(0, 4).map(describeAreaMove);
      const stuck = [...action.stuck, ...left.map((move) => move.occupancyId)].map(stayOn);
      return {
        ok: true,
        spoken:
          `Closed ${window} and moved ${moved.length} stay${moved.length === 1 ? "" : "s"} off it` +
          (moved.length > 0
            ? `, several at once: ${listWords(named)}${moved.length > named.length ? `, and ${moved.length - named.length} more` : ""}.`
            : ".") +
          (held.length > 0 ? ` ${held.length === 1 ? "One" : held.length} had to be held for a free stand.` : "") +
          (stuck.length > 0
            ? ` I couldn't move ${listWords(stuck)}, so ${stuck.length === 1 ? "it is" : "they are"} still in the closed area.`
            : "") +
          " They're demo changes, checked only for overlaps, the sample stand sizes and the closure.",
        mutated: true,
      };
    }
    case "assign_stands": {
      const placed: StandAssign[] = [];
      const toPlace: StandAssign[] = [];
      const left = [...action.unplaceable];
      for (const assign of action.assigns) {
        // Checked against the board as it is now: Skye's click may already
        // have placed it, and the user may have changed the board.
        const state = assignState(assign);
        if (state === "done") placed.push(assign);
        else if (state === "pending") toPlace.push(assign);
        else {
          left.push({
            flightId: flightsAtStay(assign.stayId)[0]?.id ?? assign.stayId,
            reason: `${stayLabel(assign.stayId)} changed since you asked, so I left it.`,
          });
        }
      }
      placed.push(...toPlace);
      // All of them, including what Skye's drags already placed: the host
      // places what is still to do and shows the whole result.
      if (placed.length > 0) host.assignStands(placed);
      return {
        ok: true,
        spoken: describeAssignments(placed, left, action.flightIds.length),
        mutated: placed.length > 0,
      };
    }
    case "unassign_stands": {
      const taken: StandRelease[] = [];
      const toTake: StandRelease[] = [];
      const moved: StandRelease[] = [];
      for (const release of action.stays) {
        const stay = occupancyById(release.stayId);
        // Already off its stand: Skye's drag up into the No stand lane took it off.
        if (!stay) taken.push(release);
        else if (stay.rowId === release.standId) toTake.push(release);
        else moved.push(release);
      }
      if (toTake.length > 0) host.unassignStands(toTake.map((release) => release.stayId));
      taken.push(...toTake);
      const one = taken.length === 1;
      const noStand = action.noStand.flatMap((id) => OPS_FLIGHTS_BY_ID.get(id) ?? []);
      const parts = [
        taken.length > 0
          ? `Took ${listWords(taken.map((release) => `${stayLabel(release.stayId)} off ${release.standId}`))}. ` +
            `${one ? "It has" : "They have"} no stand now, so ${one ? "it's" : "they're"} waiting in the No stand row.`
          : "",
        moved.length > 0
          ? `${listWords(moved.map((release) => stayLabel(release.stayId)))} moved since you asked, so I left ${moved.length === 1 ? "it" : "them"}.`
          : "",
        noStand.length > 0 ? `${listFlights(noStand)} already had no stand.` : "",
        taken.length > 0 ? `${one ? "It's a demo change" : "They're demo changes"}; Reset stands puts ${one ? "it" : "them"} back.` : "",
      ];
      return { ok: true, spoken: parts.filter(Boolean).join(" "), mutated: taken.length > 0 };
    }
  }
}
