// The operational interpreter: Mica's server route, backed by an OpenAI
// Responses model, returns one strictly-structured decision per request.
//
// Everything the model proposes is re-validated here against the real fixture
// before it can reach the app, so a hallucinated flight id, an unknown view or
// a filter value that does not exist is rejected rather than applied. The
// server's structured-output schema and this validation are deliberately
// redundant.
//
// There is no silent fallback. If no model has been chosen the route answers
// `interpreter_not_configured`, and Mica tells the user that voice actions are
// unavailable instead of quietly dropping to phrase matching.
import { validateAppAction, type AppActionName } from "./appActions.ts";
import { FILTER_OPTIONS, VIEWS } from "../operations/opsFilters.ts";
import { OPS_FLIGHTS, standMinutes } from "../operations/operationsData.ts";
import { formatUtc } from "../stand-timeline-demo/demoData.ts";
import { SYNTHETIC_STANDS } from "../stand-timeline-demo/syntheticFixture.ts";
import { PEOPLE } from "./callGuests.ts";
import { liveApiBase, liveFetch } from "./liveBackend.ts";
import { describeAlertCounts, flightLabel } from "./opsHost.ts";
import type { InterpretationRequest, InterpretedRequest, RequestInterpreter } from "./requestInterpreter.ts";

/** How much dialogue to send. The server clamps this again. */
const MAX_TRANSCRIPT_CHARS = 6_000;

export type BackendInterpreterOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

type InterpretDecision = {
  kind?: unknown;
  action_name?: unknown;
  args?: Record<string, unknown> | null;
  reason?: unknown;
  hint?: unknown;
};

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/**
 * The vocabulary the model may choose identifiers from. Sent as data so the
 * model never has to invent an id, and kept to what the fixture really holds.
 */
function boardVocabulary(request: InterpretationRequest) {
  const { snapshot } = request;
  return {
    summary: describeBoardForInterpreter(snapshot),
    // "id — human label", so the model can match spoken flight numbers, plus
    // how long the flight's stay holds its stand, so questions like "which
    // flight is on stand longest" can be answered from data, not guessed. A
    // flight with no stand says when it needs one, or that it has no times.
    allowedFlights: OPS_FLIGHTS.map((flight) => {
      const minutes = standMinutes(flight);
      const needs = flight.standId
        ? ""
        : flight.unplacedStay
          ? `, needs a stand ${formatUtc(flight.unplacedStay.start)}–${formatUtc(flight.unplacedStay.end)}`
          : ", no stay times";
      return (
        `${flight.id} — ${flightLabel(flight)}${minutes === null ? "" : `, ${minutes} min on stand`}${needs}` +
        `${flight.aircraftType ? `, ${flight.aircraftType}` : ""}`
      );
    }),
    // Resolves "that flight" / "the selected one", including for a chart
    // selection, which has no single flight id. More than one entry means the
    // reference is ambiguous and the model should ask.
    selectedFlights: snapshot.selection.flights.map(
      (entry) =>
        `${entry.id} — ${entry.flight} ${entry.direction}${entry.standId ? ` stand ${entry.standId}` : " (no stand)"}`,
    ),
    openAlerts: snapshot.openAlerts.map((alert) => `${alert.id} — ${alert.title}`),
    acknowledgedAlerts: [...snapshot.acknowledgedAlertIds],
    allowedViews: VIEWS.map((view) => view.value),
    // Who can be called into the call, who is on it, and who is being called.
    allowedPeople: [...PEOPLE],
    callGuests: [...snapshot.callGuests],
    callingGuests: [...snapshot.callingGuests],
    // Where a stay may be moved, and which stands take narrowbodies only.
    allowedStands: SYNTHETIC_STANDS.map(
      (stand) => `${stand.code} — ${stand.area}, ${stand.size === "narrow" ? "narrowbody only" : "any aircraft"}`,
    ),
    allowedFilterValues: {
      carrier: [...FILTER_OPTIONS.carrier],
      area: [...FILTER_OPTIONS.area],
      type: [...FILTER_OPTIONS.type],
    },
  };
}

function describeBoardForInterpreter(snapshot: InterpretationRequest["snapshot"]): string {
  const flights = snapshot.selection.flights;
  const selected =
    flights.length > 0
      ? `${flights.map((entry) => `${entry.flight} ${entry.direction}`).join(", ")}` +
        `${snapshot.selection.flightId === null ? ` (from ${snapshot.selection.occupancyIds.length} chart stays)` : ""}`
      : snapshot.selection.occupancyIds.length > 0
        ? `${snapshot.selection.occupancyIds.length} chart stays with no flight at them`
        : "nothing";
  const filters = (["carrier", "area", "type"] as const)
    .map((dimension) => `${dimension}=[${snapshot.filters[dimension].join(", ")}]`)
    .join(" ");
  return (
    `View ${snapshot.view}. Filters ${filters}. Selected: ${selected}. ` +
    `${snapshot.matchingFlights}/${snapshot.totalFlights} flights match. ${describeAlertCounts(snapshot.openAlerts)}`
  );
}

/**
 * Maps the model's flat argument object onto the arguments one action takes,
 * dropping nulls. Validation then decides whether what is left is acceptable.
 */
function actionArguments(name: AppActionName, args: Record<string, unknown> | null): Record<string, unknown> {
  const source = args ?? {};
  switch (name) {
    case "select_flight":
      return { flightId: source.flightId };
    case "select_flights":
      // A null mode means not provided, which validation reads as a fresh selection.
      return source.mode == null ? { flightIds: source.flightIds } : { flightIds: source.flightIds, mode: source.mode };
    case "move_stay":
      return { flightId: source.flightId, standId: source.standId };
    case "swap_stays":
      return { flightIds: source.flightIds };
    case "suggest_move":
      return { flightId: source.flightId ?? null };
    case "close_area":
      // A null from or to means not given: that end of the day on the chart.
      return { area: source.area, from: source.from ?? null, to: source.to ?? null };
    case "acknowledge_alert":
    case "unacknowledge_alert":
      return { alertId: source.alertId };
    case "set_view":
      return { view: source.view };
    case "set_filter":
      // `values` is passed through as-is. The schema makes it nullable only
      // because strict mode requires every field to be present, so null means
      // "not provided" and must be rejected; an explicit empty array is the
      // documented way to clear the dimension. Treating null as empty would
      // silently turn an incomplete decision into "clear the filter".
      return { dimension: source.dimension, values: source.values };
    case "find_flights":
      return source.direction == null
        ? { query: source.query }
        : { query: source.query, direction: source.direction };
    case "assign_stands":
      // No flights means every flight with no stand. A lone flightId is
      // taken as that one flight, since a model may fill either field.
      return {
        flightIds: source.flightIds ?? (source.flightId == null ? null : [source.flightId]),
        standId: source.standId ?? null,
      };
    case "add_to_call":
    case "remove_from_call":
      return { person: source.person };
    case "fix_all":
      // Not given means everything.
      return { scope: source.scope ?? "all" };
    case "resolve_disruption":
      // Not given means the flight the disruption notice is about.
      return { flightId: source.flightId ?? null };
    case "unassign_stands":
      return { flightIds: source.flightIds ?? (source.flightId == null ? null : [source.flightId]) };
    default:
      return {};
  }
}

/** Turns one server decision into a validated InterpretedRequest. */
export function decisionToRequest(decision: InterpretDecision): InterpretedRequest {
  if (decision.kind === "unsupported") {
    return {
      kind: "unsupported",
      reason: asText(decision.reason) ?? "Mica cannot do that.",
    };
  }
  if (decision.kind === "unclear") {
    return {
      kind: "unclear",
      hint: asText(decision.hint) ?? "I did not follow that. Could you say it another way?",
    };
  }
  if (decision.kind !== "action") {
    return { kind: "unclear", hint: "I could not work out what to do with that." };
  }

  const name = asText(decision.action_name);
  if (!name) return { kind: "unclear", hint: "I could not work out which action you wanted." };

  // The decisive check: the model's choice is validated against the fixture,
  // so an invented id or value cannot reach the app.
  const validated = validateAppAction(name, actionArguments(name as AppActionName, decision.args ?? null));
  if (!validated.ok) {
    return { kind: "unclear", hint: validated.message };
  }
  return { kind: "action", action: validated.action };
}

/**
 * Builds the interpreter.
 *
 * @param options.baseUrl Broker base URL; defaults to the same relative base
 *   the session route uses.
 */
export function createBackendInterpreter({
  baseUrl = liveApiBase(),
  fetchImpl = liveFetch,
}: BackendInterpreterOptions = {}): RequestInterpreter {
  return {
    id: "responses-backend",
    async interpret(request, signal) {
      const { snapshot } = request;
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/api/live/interpret`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            utterance: request.utterance,
            revision: snapshot.revision,
            transcript: request.transcript.slice(-MAX_TRANSCRIPT_CHARS),
            taskHistory: request.taskHistory,
            board: boardVocabulary(request),
          }),
          signal,
        });
      } catch (error) {
        // A cancelled job is the executor's concern; rethrow so it is treated
        // as stale rather than spoken about.
        if (signal?.aborted) throw error;
        return {
          kind: "unsupported",
          reason:
            "I cannot act on that right now: Mica's voice backend is not reachable, so nothing was changed.",
        };
      }

      if (!response.ok) {
        let code = `http_${response.status}`;
        let message: string | null = null;
        try {
          const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
          if (typeof body?.error?.code === "string") code = body.error.code;
          if (typeof body?.error?.message === "string") message = body.error.message;
        } catch {
          // Fall through to the generic message below.
        }
        // Configuration gaps and upstream failures are both "Mica cannot do
        // this now" — stated plainly, never silently downgraded to guessing.
        return {
          kind: "unsupported",
          reason:
            code === "interpreter_not_configured"
              ? "I cannot act on requests yet: Mica has no interpreter model configured, so nothing was changed."
              : (message ??
                "I could not work that out just now, and nothing was changed."),
        };
      }

      let payload: { revision?: unknown; decision?: InterpretDecision };
      try {
        payload = (await response.json()) as { revision?: unknown; decision?: InterpretDecision };
      } catch {
        return { kind: "unclear", hint: "I could not read that decision. Please try again." };
      }

      // Reject a decision made against board state this request has moved
      // past; the executor's own revision guard is the second line of defence.
      if (payload.revision !== snapshot.revision) {
        return {
          kind: "unclear",
          hint: "The board changed while I was working that out. Ask me again and I will use what is on screen now.",
        };
      }
      if (!payload.decision || typeof payload.decision !== "object") {
        return { kind: "unclear", hint: "I could not work out what to do with that." };
      }
      return decisionToRequest(payload.decision);
    },
  };
}

/** Which interpreter Mica uses. Backend by default; phrase mode is explicit. */
export function resolveInterpreter(mode: string | undefined, phrase: RequestInterpreter): RequestInterpreter {
  return mode === "phrase" ? phrase : createBackendInterpreter();
}
