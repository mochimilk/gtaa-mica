// What the Outputs panel lists: every change to the board, newest first, each
// under who made it: a request Skye worked on, or something the user did in
// one go (a drag, a swap, a reset); and under each, every piece it
// changed, turn by turn, newest first, as a chess game's moves are listed
// under the game. Recorded as the board changes (skyeReview).
// A piece is `working` while Skye has hold of it, then waits for approval
// with the rest of hers (skyeReview): from the user (`waiting`) as soon as it
// lands, or, when its change needs a teammate (baggage, for one that moves
// bags), it stays `working` until Skye is done, waits on them
// (`pending-approval`) once they are asked, then on the user; until it is
// approved or cancelled (`undone`, struck through, the request it is for
// saying so rather than the user's cancelling being listed). A piece
// that ends up where it was is taken off, and so is a request that changed
// nothing. While the list is empty, the panel's toggle in the board's header
// is greyed out and the panel stays closed (OutputsPanel); while Skye works
// and the panel is closed, the latest request peeks out under the board's
// header (OutputsPeek).
import type { AppAction } from "../live/appActions";
import type { Expertise } from "../live/callGuests";
import { describeShift, stayName, flightsAtStay, occupancyById, offBoardStay, stayOfFlight, type Closure, type StayPlace } from "./allocation";
import { OPS_FLIGHTS_BY_ID } from "./operationsData";
import { formatUtc } from "../stand-timeline-demo/demoData";

/**
 * `pending-approval` waits on a teammate (baggage); `waiting`, on the user
 * alone. `done` is approved, or left with nothing to approve (Skye put it
 * back herself).
 */
export type OutputStatus = "working" | "pending-approval" | "waiting" | "done" | "undone";

/** One piece changed: a stay moved, placed or taken off its stand, or an area closed or reopened. */
export type OutputStep = {
  id: string;
  /** The stay it is, to find on the board; none for an area's closure. */
  stayId?: string;
  /** "XA101/102", "Pier B". */
  title: string;
  /** "A1 → C25", "Closed 06:00–08:00". */
  detail: string;
  status: OutputStatus;
  /** The teammate who has to approve it before the user (baggage, for one that moves bags). */
  needs?: { name: string; expertise: Expertise };
  /** Where the stay was before the change and where it is after, for a stay's. */
  move?: { from: StayPlace; to: StayPlace };
  /** That teammate, once they have. */
  approvedBy?: string;
};

/** Who changed the board: Skye, or the user. */
export type OutputActor = "skye" | "user";

/** A request Skye worked on, or something the user did, and the pieces it changed, newest first. */
export type OutputRequest = {
  id: string;
  /** What Skye set about doing ("Fix all conflicts"), or what the user did ("Moved XA101/102 to stand C25"). */
  title: string;
  actor: OutputActor;
  /** While Skye is still on it. */
  working: boolean;
  steps: readonly OutputStep[];
  /** Once Skye's changes for it are approved: who approved them, when, and what they did to the board. */
  decision?: OutputDecision;
};

/** One of the board's figures before Skye's changes and after: "Gate hold", "5h 45m", "none". */
export type DecisionFigure = { label: string; before: string; after: string; better: boolean | null };

/**
 * The log of an approval: when (Date.now()), who approved, in order (the user
 * last), each teammate who approved before the user with when they did, and
 * the figures.
 */
export type OutputDecision = {
  at: number;
  by: readonly string[];
  signoffs: readonly { name: string; at: number }[];
  figures: readonly DecisionFigure[];
};

let requests: readonly OutputRequest[] = [];
const listeners = new Set<() => void>();
let ids = 0;

function set(next: readonly OutputRequest[]): void {
  requests = next;
  for (const listener of listeners) listener();
}

const updateRequest = (id: string, update: (request: OutputRequest) => OutputRequest | null) =>
  set(requests.flatMap((request) => (request.id === id ? (update(request) ?? []) : [request])));

/** For useSyncExternalStore. */
export const outputs = (): readonly OutputRequest[] => requests;
export function subscribeOutputs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lists a request Skye has started on, or something the user is doing; returns its id. */
export function startRequest(title: string, actor: OutputActor = "skye"): string {
  const id = `request-${(ids += 1)}`;
  set([{ id, title, actor, working: true, steps: [] }, ...requests]);
  return id;
}

/**
 * Adds a piece to a request, or updates the one with the same id in place
 * (Skye took hold of it, then it landed); a new one goes to the top.
 */
export function putStep(requestId: string, step: OutputStep): void {
  updateRequest(requestId, (request) => {
    const has = request.steps.some((entry) => entry.id === step.id);
    return {
      ...request,
      steps: has ? request.steps.map((entry) => (entry.id === step.id ? step : entry)) : [step, ...request.steps],
    };
  });
}

export function removeStep(requestId: string, stepId: string): void {
  updateRequest(requestId, (request) => ({ ...request, steps: request.steps.filter((step) => step.id !== stepId) }));
}

/** Skye is done with a request; one that changed nothing is taken off the list. */
export function finishRequest(requestId: string): void {
  updateRequest(requestId, (request) => (request.steps.length > 0 ? { ...request, working: false } : null));
}

/** Moves the pieces named on to `status`, in whichever request they are. */
export function setStepStatus(stepIds: Iterable<string>, status: OutputStatus): void {
  const named = new Set(stepIds);
  const touches = (step: OutputStep) => named.has(step.id) && step.status !== status;
  if (!requests.some((request) => request.steps.some(touches))) return;
  set(
    requests.map((request) =>
      request.steps.some(touches)
        ? { ...request, steps: request.steps.map((step) => (named.has(step.id) ? { ...step, status } : step)) }
        : request,
    ),
  );
}

/** Notes the teammate who approved the pieces named. */
export function setStepApprover(stepIds: Iterable<string>, name: string): void {
  const named = new Set(stepIds);
  const touches = (step: OutputStep) => named.has(step.id) && step.approvedBy !== name;
  if (!requests.some((request) => request.steps.some(touches))) return;
  set(
    requests.map((request) =>
      request.steps.some(touches)
        ? { ...request, steps: request.steps.map((step) => (touches(step) ? { ...step, approvedBy: name } : step)) }
        : request,
    ),
  );
}

/** "Travis Hughes and you": who approved a decision, as said. */
export function describeApprovers(names: readonly string[]): string {
  const said = names.map((name) => (name === "You" ? "you" : name));
  return said.length <= 1 ? (said[0] ?? "") : `${said.slice(0, -1).join(", ")} and ${said.at(-1)}`;
}

const logClock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** "14:32", on the user's own clock: when a decision was logged. */
export const formatLogTime = (at: number) => logClock.format(at);

/** Logs an approval on each request that has any of the pieces named. */
export function logDecision(stepIds: Iterable<string>, decision: OutputDecision): void {
  const named = new Set(stepIds);
  if (!requests.some((request) => request.steps.some((step) => named.has(step.id)))) return;
  set(requests.map((request) => (request.steps.some((step) => named.has(step.id)) ? { ...request, decision } : request)));
}

export function clearOutputs(): void {
  if (requests.length > 0) set([]);
}

/* ------------------------------------------------------------- the words */

/** "XA101/102": a stay's flights, on a stand or waiting for one. */
export function stayLabel(stayId: string): string {
  const stay = occupancyById(stayId) ?? offBoardStay(stayId);
  return stay ? stayName(stay) : (flightsAtStay(stayId)[0]?.flight ?? stayId);
}

function flightLabel(flightId: string): string {
  const flight = OPS_FLIGHTS_BY_ID.get(flightId);
  const stay = stayOfFlight(flight);
  return stay ? stayName(stay) : (flight?.flight ?? flightId);
}

/** "A1 → C25", "No stand → B14", "C20 → No stand", "A1 → C25, 15m later", "30m later on C25". */
export function describeMove(from: StayPlace, to: StayPlace): string {
  const shiftMs = to.start - from.start;
  const stand = (rowId: string) => rowId || "No stand";
  if (from.rowId && from.rowId === to.rowId) return `${describeShift(shiftMs)} on ${to.rowId}`;
  return `${stand(from.rowId)} → ${stand(to.rowId)}${shiftMs && from.rowId && to.rowId ? `, ${describeShift(shiftMs)}` : ""}`;
}

/** "Closed 06:00–08:00", "Reopened". */
export function describeClosure(to: Closure | null): string {
  return to ? `Closed ${formatUtc(to.from)}–${formatUtc(to.to)}` : "Reopened";
}

/**
 * What Skye is about to do to the board, as a request's title: "Move
 * XA101/102 to stand C25". Null for an action that does not change the board
 * (a selection, a view, a filter, a call), which the Outputs panel leaves out.
 */
export function describeBoardAction(action: AppAction): string | null {
  switch (action.name) {
    case "move_stay":
      return `Move ${flightLabel(action.flightId)} to stand ${action.standId}`;
    case "swap_stays":
      return `Swap ${flightLabel(action.flightIds[0])} and ${flightLabel(action.flightIds[1])}`;
    case "close_area":
      return `Close ${action.area}, ${formatUtc(action.from)}–${formatUtc(action.to)}`;
    case "assign_stands": {
      const [only] = action.assigns;
      return action.assigns.length === 1
        ? `Assign ${stayLabel(only.stayId)} to stand ${only.standId}`
        : `Assign stands to ${action.assigns.length} flights`;
    }
    case "unassign_stands": {
      const [only] = action.stays;
      return action.stays.length === 1
        ? `Take ${stayLabel(only.stayId)} off stand ${only.standId}`
        : `Take ${action.stays.length} flights off their stands`;
    }
    case "fix_all":
      return action.scope === "conflicts" ? "Fix all conflicts" : "Fix conflicts and flights with no stand";
    case "resolve_disruption":
      return `Clear ${flightLabel(action.flightId)}'s knock-on`;
    default:
      return null;
  }
}

/**
 * What the user did, from how the board changed: "Moved XA101/102 to stand
 * C25", "Swapped XA101/102 and XB212/213", "Took XA640/641 off stand C20",
 * "Gave XB240 stand B14", "Closed Pier B"; "Changed 4 stays" for more.
 */
export function describeUserChange(
  before: { stays: ReadonlyMap<string, StayPlace>; closure: Closure | null },
  after: { stays: ReadonlyMap<string, StayPlace>; closure: Closure | null },
): string {
  const moved = [...after.stays].flatMap(([stayId, to]) => {
    const from = before.stays.get(stayId);
    return from && (from.rowId !== to.rowId || from.start !== to.start || from.end !== to.end) ? [{ stayId, from, to }] : [];
  });
  const closure = after.closure ?? before.closure;
  const closed =
    before.closure?.area !== after.closure?.area || before.closure?.from !== after.closure?.from || before.closure?.to !== after.closure?.to;
  if (moved.length === 0) return closed && closure ? `${after.closure ? "Closed" : "Reopened"} ${closure.area}` : "Changed the board";
  if (moved.length === 2) {
    const [a, b] = moved;
    if (a.from.rowId && b.from.rowId && a.to.rowId === b.from.rowId && b.to.rowId === a.from.rowId) {
      return `Swapped ${stayLabel(a.stayId)} and ${stayLabel(b.stayId)}`;
    }
  }
  if (moved.length > 1) return `Changed ${moved.length} stays`;
  const [{ stayId, from, to }] = moved;
  const name = stayLabel(stayId);
  if (!to.rowId) return `Took ${name} off stand ${from.rowId}`;
  if (!from.rowId) return `Gave ${name} stand ${to.rowId}`;
  if (from.rowId === to.rowId) return `Moved ${name} ${describeShift(to.start - from.start)} on ${to.rowId}`;
  return `Moved ${name} to stand ${to.rowId}`;
}

/**
 * Where a request stands, for its header: "Working" and "3 changes", or
 * "Waiting for approval" (`waiting`, for the user to see) and "7 changes", or
 * "Cancelled by you" (`cancelled`, its pieces struck through) and "2 changes".
 */
export function describeRequest(request: OutputRequest): { status?: string; count?: string; waiting: boolean; cancelled?: boolean } {
  const count = `${request.steps.length} change${request.steps.length === 1 ? "" : "s"}`;
  if (request.working) return request.steps.length > 0 ? { status: "Working", count, waiting: false } : { status: "Working…", waiting: false };
  const statuses = new Set(request.steps.map((step) => step.status));
  if (statuses.has("pending-approval") || statuses.has("waiting")) return { status: "Waiting for approval", count, waiting: true };
  if (statuses.size === 1 && statuses.has("undone")) return { status: "Cancelled by you", count, waiting: false, cancelled: true };
  if (statuses.size === 1 && statuses.has("done")) return { status: "Done", count, waiting: false };
  return { count, waiting: false };
}
