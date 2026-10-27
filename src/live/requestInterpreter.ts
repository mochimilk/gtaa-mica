// Turning a reconstructed utterance into a validated app action.
//
// WHY THIS LAYER EXISTS
// `session.delegation.created` carries a delegation id, a target and a timeline
// offset — and explicitly not the user's words. With `delegation: { type:
// "client" }` the app is the executor, so Mica has to work out *what* was asked
// from the transcript it accumulated plus its own saved context.
//
// WHAT IS IMPLEMENTED HERE, AND WHAT IS NOT
// `phraseInterpreter` is a deterministic phrase matcher over Mica's own
// fixture vocabulary. It is NOT a conversational agent: it understands a
// bounded set of phrasings about flights, views, filters and demo alerts,
// ignores conversation and task history entirely (so it cannot follow up or
// take a correction), and answers "unclear" for everything else rather than
// guessing.
//
// The operational interpreter is `backendInterpreter` in backendInterpreter.ts,
// which asks an OpenAI Responses model through Mica's own server route for one
// strictly-structured decision. Phrase mode is a deliberate opt-in for demos
// and tests (`VITE_MICA_INTERPRETER=phrase`) and is never a silent fallback:
// if the backend interpreter is unconfigured or failing, Mica says so.
//
// Which model the backend interpreter uses is still the user's decision; see
// docs/gpt-live-voice.md, "Remaining decision".
import { currentAlerts } from "../operations/boardAlerts.ts";
import { OPS_FLIGHTS, OPS_FLIGHTS_BY_ID, standMinutes, type OpsFlight } from "../operations/operationsData.ts";
import { FILTER_OPTIONS, UNASSIGNED_AREA, VIEWS, type FilterDim, type ViewKey } from "../operations/opsFilters.ts";
import { SYNTHETIC_STANDS } from "../stand-timeline-demo/syntheticFixture.ts";
import { validateAppAction, type AppAction } from "./appActions.ts";
import { PEOPLE } from "./callGuests.ts";
import type { OpsSnapshot } from "./opsHost.ts";

export type InterpretedRequest =
  /** Understood and validated. */
  | { kind: "action"; action: AppAction }
  /** Understood, but Mica genuinely cannot do it. */
  | { kind: "unsupported"; reason: string }
  /** Not understood. Never guessed at. */
  | { kind: "unclear"; hint: string };

/** One finished task, so a later request can correct or follow up on it. */
export type TaskHistoryEntry = {
  /** What was reconstructed from the transcript. */
  utterance: string;
  /** The action that ran, or null when nothing did. */
  action: string | null;
  outcome: "applied" | "rejected" | "unsupported" | "unclear";
  /** What the user was told. */
  result: string;
  /**
   * What was offered and not yet done (a suggested move or swap): the next
   * request may confirm it. Interpreters must not act on it otherwise.
   */
  proposal?: AppAction;
};

export type InterpretationRequest = {
  /** The request reconstructed from the transcript for this delegation. */
  utterance: string;
  /** Validated board state, including the revision it was read at. */
  snapshot: OpsSnapshot;
  /** Recent dialogue, oldest first, for pronouns and corrections. */
  transcript: string;
  /** Recent finished tasks, oldest last. */
  taskHistory: readonly TaskHistoryEntry[];
};

export interface RequestInterpreter {
  /** Identifies the interpreter in logs and in the executor's quiet context. */
  readonly id: string;
  /**
   * @param signal Aborted when the job is cancelled or superseded. An
   *   interpreter that calls out to a backend must forward this, so cancelling
   *   stops the request rather than merely discarding its answer.
   */
  interpret(request: InterpretationRequest, signal?: AbortSignal): Promise<InterpretedRequest>;
}

/* ------------------------------------------------------------- vocabulary */

/** Flight code → flight ids. More than one when a code is both legs. */
const flightsByCode = new Map<string, string[]>();
for (const flight of OPS_FLIGHTS) {
  const code = flight.flight.toUpperCase();
  const existing = flightsByCode.get(code);
  if (existing) existing.push(flight.id);
  else flightsByCode.set(code, [flight.id]);
}

/** A flight's alerts on the board now, open or acknowledged. */
const alertIdsOf = (flightId: string) =>
  currentAlerts()
    .filter((alert) => alert.flightId === flightId)
    .map((alert) => alert.id);

const VIEW_PHRASES: { view: ViewKey; patterns: RegExp[] }[] = [
  { view: "attention", patterns: [/needs?\s+attention/, /attention\s+view/, /problem\s+flights?/] },
  { view: "arrivals", patterns: [/\barrivals?\b/] },
  { view: "departures", patterns: [/\bdepartures?\b/] },
  { view: "tows", patterns: [/\btows?\b/, /\btowed\b/, /towing/] },
  { view: "all", patterns: [/all\s+activity/, /\beverything\b/, /\ball\s+flights?\b/] },
];

/** A yes to what was just offered. Only ever acts on a proposal from the last task. */
const CONFIRM_CUE = /^(yes|yeah|yep|sure|ok|okay|go ahead|do it|please do|confirm|confirmed|sounds good|let'?s do it)\b/;
/** Asking Mica to find a stand change, rather than naming one. */
const SUGGEST_CUE = /\b(best|better|optimi[sz]e|suggest|recommend|improve)\b/;
const STAND_CHANGE_CUE = /\b(move|moves|swap|swaps|stand|stands|slot|gap|gaps|buffer|spot)\b/;
const SWAP_CUE = /\b(swap|exchange|trade)\b/;
const MOVE_CUE = /\b(move|put|shift|drag|drop|reassign|re-?assign)\b/;
/** Taking flights off their stands. */
const UNASSIGN_CUE =
  /\b(unassign|un-assign|de-?allocate|release)\b|\btake\b.*\boff\b.*\b(stands?|chart)\b|\bremove\b.*\bfrom\b.*\bstands?\b/;
/** Giving stands to flights that have none. "Fix those" alone is left to the model, which has the history. */
const ASSIGN_CUE =
  /\b(assign|allocate)\b|\b(give|find|place)\b.*\bstands?\b|\b(fix|place|sort out)\b.*\b(no[- ]stand|unassigned)\b/;
const CONFLICT_CUE = /\b(conflicts?|clash(es|ing)?|knock-?ons?)\b/;
/**
 * Getting going, however it is put: a sample of the ways people start a
 * shift or ask what to do next. The model interpreter is told the intent and
 * handles phrasings this misses.
 */
const BRIEF_CUE =
  /\b(start(ing)? (my|the|our) (day|shift)|what does (my|our|the) (day|shift|morning) look like|how('?s| is| are)( the| my| our)? (stands?|board|day|morning|shift) (look(ing)?|shaping up)|how (are|is) (we|things) (looking|shaping up)|docket|on (my|our|the) plate|open items?|anything (open|outstanding|pending|urgent)|what('?s| is| do we have) (open|outstanding|pending|next|on)|what else|what now|catch me up|up to speed|where (are we|do we stand|do things stand|things stand)|brief(ing)?|run-?down|to-?do|priorit\w*|(go|run) (over|through) the alerts)\b|^(next|next one|morning|good morning)\b/;
/** Asking for every alert read out, rather than a rundown. */
const LIST_ALL_CUE = /\b(list|read( out)?|every|all)\b.*\balerts?\b/;

/** Someone from the people list named in the utterance: the full name, or a first name only one person has. */
function mentionedPerson(normalized: string): string | undefined {
  const full = PEOPLE.find((name) => normalized.includes(name.toLowerCase()));
  if (full) return full;
  const byFirst = PEOPLE.filter((name) => new RegExp(`\\b${name.split(" ")[0].toLowerCase()}\\b`).test(normalized));
  return byFirst.length === 1 ? byFirst[0] : undefined;
}

/** "Priya Raman, Marcus Chen, Aisha Okafor or Travis Hughes". */
const listPeople = () => (PEOPLE.length <= 1 ? (PEOPLE[0] ?? "") : `${PEOPLE.slice(0, -1).join(", ")} or ${PEOPLE.at(-1)}`);

/** Stands named in the utterance, matched as whole words ("to c25"). */
function mentionedStands(normalized: string): string[] {
  return SYNTHETIC_STANDS.map((stand) => stand.code).filter((code) =>
    new RegExp(`\\b${code.toLowerCase()}\\b`).test(normalized),
  );
}

/* ---------------------------------------------------------- closing an area */

/** A stand area named in the utterance: "pier b" → "Pier B", "remote stands" → "Remote". */
function mentionedArea(normalized: string): string | null {
  const pier = /\bpier\s+([a-d])\b/.exec(normalized);
  if (pier) return `Pier ${pier[1].toUpperCase()}`;
  return /\bremote\b/.test(normalized) ? "Remote" : null;
}

/** Saying the area is out of use: closed, shut, down for maintenance, lost power... */
const CLOSURE_CUE =
  /\b(clos(e|ed|es|ing|ure)|shut(ting)?|evacuat\w*|out of (service|action|use)|unavailable|maintenance|inspection|outage|lost (power|its)|power (cut|failure|outage)|no power)\b/;
/** Or asking for it to be emptied: "move everything off pier b", "clear out pier b". */
const EMPTY_CUE = /\b(everything|every (flight|stay|aircraft)|all (the )?(flights|stays|aircraft))\b.*\b(off|out of|away from)\b|\bclear (out |off )?(the )?(pier|remote)\b/;

const TIME = String.raw`(\d{1,2})(?::?(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`;
const TIME_RANGE = new RegExp(String.raw`\b${TIME}\s*(?:to|until|till|through|-|–|—|and)\s*${TIME}`);
const TIME_UNTIL = new RegExp(String.raw`\b(?:until|till|through)\s*${TIME}`);
const TIME_FROM = new RegExp(String.raw`\b(?:from|after|starting)\s*${TIME}`);

/** Minutes after midnight, or null. "pm" adds 12 hours; "12 am" is midnight. */
function clockMinutes(hour: string, minute: string | undefined, meridiem: string | undefined): number | null {
  let h = Number(hour);
  const m = Number(minute ?? 0);
  if (h > 23 || m > 59) return null;
  if (meridiem?.startsWith("p") && h < 12) h += 12;
  if (meridiem?.startsWith("a") && h === 12) h = 0;
  return h * 60 + m;
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * The time window in "Pier B is closed from 9 to 1": UTC "HH:MM" strings, or
 * null for an end not given (the closure then runs to that end of the day).
 * Hours without am/pm are read as the working day: "9 to 1" is 09:00–13:00,
 * and a start before 05:00 ("from 2 to 4") is in the afternoon.
 */
function closureWindow(normalized: string): { from: string | null; to: string | null } {
  const range = TIME_RANGE.exec(normalized);
  if (range) {
    let from = clockMinutes(range[1], range[2], range[3]);
    let to = clockMinutes(range[4], range[5], range[6]);
    if (from !== null && to !== null) {
      if (!range[3] && from < 5 * 60) from += 12 * 60;
      if (!range[6] && to <= from && to + 12 * 60 > from) to += 12 * 60;
      if (to > from && to <= 24 * 60) return { from: hhmm(from), to: hhmm(Math.min(to, 23 * 60 + 59)) };
    }
  }
  const until = TIME_UNTIL.exec(normalized);
  const after = TIME_FROM.exec(normalized);
  const read = (match: RegExpExecArray | null) => {
    const minutes = match ? clockMinutes(match[1], match[2], match[3]) : null;
    return minutes === null ? null : hhmm(!match?.[3] && minutes < 5 * 60 ? minutes + 12 * 60 : minutes);
  };
  return { from: read(after), to: read(until) };
}

/**
 * A request to close a stand area and move what is on it, with its time
 * window: "Pier B is closed from 9 to 1, move everything off it". Null when
 * the utterance is not one.
 */
export function matchAreaClosure(utterance: string): { area: string; from: string | null; to: string | null } | null {
  const normalized = normalize(utterance);
  const area = mentionedArea(normalized);
  if (!area || /\bfilters?\b/.test(normalized)) return null;
  if (!CLOSURE_CUE.test(normalized) && !EMPTY_CUE.test(normalized)) return null;
  return { area, ...closureWindow(normalized) };
}

/** Cue words that mean "keep the selection and add to it". */
const ADD_CUE = /\b(also|add|too|as well|plus)\b/;

/** Cue words that mean "change the filters", not "tell me about". */
const FILTER_CUE = /\b(filter|filters?\s+(?:by|to)|only|just\s+show|limit\s+to|narrow)\b/;
const VIEW_CUE = /\b(show|switch|change|go|view|display|set)\b/;

/* -------------------------------------------------------------- utilities */

/** Lowercase, single-spaced. Used for word-boundary matching. */
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
/** Alphanumerics only, uppercase — collapses "x b 2 4 0" onto "XB240". */
const squash = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a fixture value is mentioned. Values are matched on word boundaries
 * so a carrier code like "XB" cannot be picked out of the middle of a flight
 * number, and alphanumeric values are additionally matched in their squashed
 * form so "b 738" counts as "B738".
 */
function mentions(normalized: string, squashed: string, value: string): boolean {
  if (new RegExp(`\\b${escapeRegExp(value.toLowerCase())}\\b`).test(normalized)) return true;
  const squashedValue = squash(value);
  return squashedValue.length >= 3 && squashed.includes(squashedValue);
}

/** Flight codes mentioned in the utterance, longest first. */
function mentionedFlightCodes(squashed: string): string[] {
  return [...flightsByCode.keys()]
    .filter((code) => squashed.includes(code))
    .sort((a, b) => b.length - a.length);
}

/**
 * The codes the user named, in the order they said them. A code found only
 * inside a longer mentioned code is dropped, so it is not counted twice.
 */
function inSpokenOrder(codes: readonly string[], squashed: string): string[] {
  return codes
    .filter((code) => !codes.some((other) => other !== code && other.includes(code)))
    .sort((a, b) => squashed.indexOf(a) - squashed.indexOf(b));
}

function resolveFlightId(code: string, normalized: string): { ok: true; flightId: string } | { ok: false; hint: string } {
  const ids = flightsByCode.get(code) ?? [];
  if (ids.length === 1) return { ok: true, flightId: ids[0] };
  const wantsArrival = /\barriv/.test(normalized);
  const wantsDeparture = /\bdepart/.test(normalized);
  if (wantsArrival !== wantsDeparture) {
    const wanted = wantsArrival ? "arrival" : "departure";
    const match = ids.find((id) => OPS_FLIGHTS_BY_ID.get(id)?.direction === wanted);
    if (match) return { ok: true, flightId: match };
  }
  return { ok: false, hint: `${code} has an arrival and a departure. Say which one you mean.` };
}

/**
 * The flight whose stay holds its stand longest (or shortest). An arrival and
 * a departure on the same stay tie, and the arrival wins, being listed first.
 */
function longestStay(longest: boolean): OpsFlight | null {
  let best: OpsFlight | null = null;
  let bestMinutes = 0;
  for (const flight of OPS_FLIGHTS) {
    const minutes = standMinutes(flight);
    if (minutes === null) continue;
    if (best === null || (longest ? minutes > bestMinutes : minutes < bestMinutes)) {
      best = flight;
      bestMinutes = minutes;
    }
  }
  return best;
}

/** Wraps validation so an interpreter can never emit an unvalidated action. */
function action(name: string, args: Record<string, unknown> = {}): InterpretedRequest {
  const result = validateAppAction(name, args);
  if (!result.ok) return { kind: "unclear", hint: result.message };
  return { kind: "action", action: result.action };
}

/* --------------------------------------------------------- the interpreter */

/**
 * Bounded, deterministic interpretation. Precedence is explicit and ordered
 * most-specific first, so adding a phrase cannot silently shadow another.
 */
function interpretPhrase(
  utterance: string,
  snapshot: OpsSnapshot,
  taskHistory: readonly TaskHistoryEntry[] = [],
): InterpretedRequest {
  const normalized = normalize(utterance);
  const squashed = squash(utterance);
  if (normalized.length === 0) return { kind: "unclear", hint: "I did not catch that." };

  // 0. Stand changes. A yes carries out the move or swap just suggested, and
  //    nothing else: a suggestion is never acted on without one.
  const pending = taskHistory.at(-1)?.proposal;
  if (pending && CONFIRM_CUE.test(normalized)) {
    const { name, ...args } = pending;
    return action(name, args);
  }
  // A whole area closing, with everything on it to move elsewhere.
  const closing = matchAreaClosure(utterance);
  if (closing) return action("close_area", closing);
  const spokenCodes = mentionedFlightCodes(squashed);
  if (SUGGEST_CUE.test(normalized) && STAND_CHANGE_CUE.test(normalized)) {
    if (spokenCodes.length === 0) return action("suggest_move", { flightId: null });
    const subject = resolveFlightId(spokenCodes[0], normalized);
    return subject.ok ? action("suggest_move", { flightId: subject.flightId }) : { kind: "unclear", hint: subject.hint };
  }
  const ordered = inSpokenOrder(spokenCodes, squashed);
  if (SWAP_CUE.test(normalized) && ordered.length === 2) {
    const flightIds: string[] = [];
    for (const code of ordered) {
      const each = resolveFlightId(code, normalized);
      if (!each.ok) return { kind: "unclear", hint: each.hint };
      flightIds.push(each.flightId);
    }
    return action("swap_stays", { flightIds });
  }
  const resolveAll = (codes: readonly string[]): { ok: true; flightIds: string[] } | { ok: false; hint: string } => {
    const flightIds: string[] = [];
    for (const code of codes) {
      const each = resolveFlightId(code, normalized);
      if (!each.ok) return each;
      flightIds.push(each.flightId);
    }
    return { ok: true, flightIds };
  };
  if (UNASSIGN_CUE.test(normalized)) {
    if (ordered.length === 0) {
      return { kind: "unclear", hint: "Say which flights to take off their stands, for example: unassign XA101." };
    }
    const named = resolveAll(ordered);
    return named.ok ? action("unassign_stands", { flightIds: named.flightIds }) : { kind: "unclear", hint: named.hint };
  }
  if (MOVE_CUE.test(normalized) && ordered.length === 1) {
    const stands = mentionedStands(normalized);
    if (stands.length !== 1) return { kind: "unclear", hint: `Which stand should ${ordered[0]} go to?` };
    const subject = resolveFlightId(ordered[0], normalized);
    if (!subject.ok) return { kind: "unclear", hint: subject.hint };
    // A flight with no stand has no stay to move: putting it on a stand gives it one.
    return OPS_FLIGHTS_BY_ID.get(subject.flightId)?.standId
      ? action("move_stay", { flightId: subject.flightId, standId: stands[0] })
      : action("assign_stands", { flightIds: [subject.flightId], standId: stands[0] });
  }
  // Everything at once: "fix all the alerts", "just fix everything", "clear
  // all the conflicts". Only the flights with no stand is assign_stands, below.
  if (
    /\b(fix|clear|resolve|sort( out)?|handle|deal with)\b/.test(normalized) &&
    /\b(all|everything|every one|them all)\b/.test(normalized) &&
    !/\b(unassigned|no[- ]stands?|flights? without)\b/.test(normalized)
  ) {
    return action("fix_all", { scope: /\bconflicts?\b/.test(normalized) && !/\balerts?\b/.test(normalized) ? "conflicts" : "all" });
  }
  if (ASSIGN_CUE.test(normalized)) {
    // No flight named: every flight with no stand.
    if (ordered.length === 0) return action("assign_stands");
    const named = resolveAll(ordered);
    if (!named.ok) return { kind: "unclear", hint: named.hint };
    const stands = mentionedStands(normalized);
    const standId = named.flightIds.length === 1 && stands.length === 1 ? stands[0] : null;
    // "Assign XA101 to C25" for a flight already on a stand is a move.
    if (standId && OPS_FLIGHTS_BY_ID.get(named.flightIds[0])?.standId) {
      return action("move_stay", { flightId: named.flightIds[0], standId });
    }
    return action("assign_stands", { flightIds: named.flightIds, standId });
  }

  // 1. Things Mica genuinely cannot do, checked first so they are never
  //    mistaken for a selection request.
  if (MOVE_CUE.test(normalized) && /\bstand|\bgate|\bbay/.test(normalized)) {
    return { kind: "unclear", hint: "Say the flight and the stand, for example: move XA101 to C25." };
  }
  if (/\b(park|tow)\b/.test(normalized) && /\bstand|\bgate|\bbay/.test(normalized)) {
    return {
      kind: "unsupported",
      reason:
        "I can't add tows or parking: Mica has no allocation backend. I can move or swap stays, give a stand to a flight " +
        "with none, or take a flight off its stand.",
    };
  }
  // Bringing a teammate into the call, or taking them off: only on the call
  // window, so not "contacting" anyone.
  const person = mentionedPerson(normalized);
  if (person && /\b(remove|drop|kick|hang up on)\b|\btake\b.*\boff\b/.test(normalized)) {
    return action("remove_from_call", { person });
  }
  if (person && /\b(add|bring|invite|loop|pull|get|call|patch|conference|dial)\b/.test(normalized)) {
    return action("add_to_call", { person });
  }
  if (/\b(add|bring|invite|loop|get)\b.*\b(call)\b/.test(normalized)) {
    return { kind: "unclear", hint: `Who should I add? I can bring in ${listPeople()}.` };
  }
  if (/\b(message|email|notify|text|phone)\b/.test(normalized)) {
    return { kind: "unsupported", reason: "Mica cannot message anyone; it only shows this synthetic board and its call window." };
  }
  if (/\b(delay|retime|re-?time|change the time|push back the)\b/.test(normalized)) {
    return { kind: "unsupported", reason: "Mica cannot change flight times; the schedule is a fixed synthetic fixture." };
  }

  const acknowledging = /\b(acknowledge|acknowledged|acknowledging|ack|dismiss|clear)\b/.test(normalized) && /\balert/.test(normalized);
  const unacknowledging = /\b(unacknowledge|un-?ack|reopen|re-?open|put back)\b/.test(normalized);

  // 2. A flight code is the strongest signal available.
  const codes = mentionedFlightCodes(squashed);
  if (codes.length > 0) {
    const resolved = resolveFlightId(codes[0], normalized);
    if (!resolved.ok) return { kind: "unclear", hint: resolved.hint };

    if (acknowledging || unacknowledging) {
      const alertIds = alertIdsOf(resolved.flightId);
      if (alertIds.length === 0) {
        return { kind: "unclear", hint: `${codes[0]} has no demo alert to ${unacknowledging ? "reopen" : "acknowledge"}.` };
      }
      if (alertIds.length > 1) {
        return { kind: "unclear", hint: `${codes[0]} has several alerts. Name the one you mean.` };
      }
      return action(unacknowledging ? "unacknowledge_alert" : "acknowledge_alert", { alertId: alertIds[0] });
    }
    // "where is XB240", "find XB240" — a lookup, not a selection.
    if (/\b(find|search|look\s+for|any)\b/.test(normalized) && !/\b(select|show\s+me|open|pull\s+up|go\s+to)\b/.test(normalized)) {
      return action("find_flights", { query: codes[0] });
    }
    // "select XB240 and XC118", "also select XA101": several flights, or
    // more on top of what is selected, are selected together on the chart.
    const adding = ADD_CUE.test(normalized);
    const named = inSpokenOrder(codes, squashed);
    if (named.length > 1 || adding) {
      const flightIds: string[] = [];
      for (const code of named) {
        const each = resolveFlightId(code, normalized);
        if (!each.ok) return { kind: "unclear", hint: each.hint };
        flightIds.push(each.flightId);
      }
      return action("select_flights", { flightIds, mode: adding ? "add" : "replace" });
    }
    return action("select_flight", { flightId: resolved.flightId });
  }

  // 3. Alert acknowledgement without a flight code.
  if (acknowledging || unacknowledging) {
    if (unacknowledging) {
      const acknowledged = snapshot.acknowledgedAlertIds;
      if (acknowledged.length === 1) return action("unacknowledge_alert", { alertId: acknowledged[0] });
      return {
        kind: "unclear",
        hint: acknowledged.length === 0 ? "No demo alerts are acknowledged." : "Say which alert to reopen, by flight.",
      };
    }
    if (snapshot.openAlerts.length === 1) return action("acknowledge_alert", { alertId: snapshot.openAlerts[0].id });
    return {
      kind: "unclear",
      hint:
        snapshot.openAlerts.length === 0
          ? "There are no open demo alerts."
          : `There are ${snapshot.openAlerts.length} open alerts. Say which flight's alert to acknowledge.`,
    };
  }

  // 4. Selection and filter resets.
  if (/\b(clear|cancel|drop|remove|deselect)\b/.test(normalized) && /\bselection|\bselected\b/.test(normalized)) {
    return action("clear_selection");
  }
  if (/\b(clear|reset|remove|drop)\b/.test(normalized) && /\bfilters?\b/.test(normalized)) {
    return action("reset_filters");
  }

  // 5. "Which flight is on stand longest / shortest": answered by selecting
  //    it, so the user is shown the flight rather than only told.
  //    "most"/"least" only count next to "time", so "the most flights on a
  //    stand" is not read as a stand-time question.
  const extreme = /\b(longest|shortest)\b/.exec(normalized) ?? /\b(most|least) (?:\w+ )?time\b/.exec(normalized);
  if (extreme && /\b(stand|gate|ground|parked|occupy|occupying|occupies)\b/.test(normalized)) {
    const longest = extreme[1] === "longest" || extreme[1] === "most";
    const best = longestStay(longest);
    if (best) return action("select_flight", { flightId: best.id });
  }

  // 6. Filters, but only with an explicit filtering cue, so "how many
  //    Air Canada flights" is not silently turned into a board change.
  if (FILTER_CUE.test(normalized)) {
    const dimensions = Object.keys(FILTER_OPTIONS) as FilterDim[];
    for (const dimension of dimensions) {
      const values = FILTER_OPTIONS[dimension].filter((value) =>
        value === UNASSIGNED_AREA
          ? /\bunassigned\b|\bno stand\b/.test(normalized)
          : mentions(normalized, squashed, value),
      );
      if (values.length > 0) return action("set_filter", { dimension, values });
    }
  }

  // 6½. Getting going: what is open, where to start, what comes next.
  if (BRIEF_CUE.test(normalized)) return action("brief");

  // 7. Views, which need a cue verb or an unambiguous view phrase.
  for (const entry of VIEW_PHRASES) {
    if (!entry.patterns.some((pattern) => pattern.test(normalized))) continue;
    // A question about alerts is not a request to change the view.
    if (/^(what|which|how many|are there|do we have|any)\b/.test(normalized)) break;
    if (VIEW_CUE.test(normalized) || entry.view === "attention") {
      return action("set_view", { view: entry.view });
    }
  }

  // 8. Read-only questions.
  if (/\bselect(ed|ion)?\b/.test(normalized) && /^(what|which|anything|is there)\b/.test(normalized)) {
    return action("describe_selection");
  }
  // "Any unassigned flights?", "which flights don't have a stand": a search
  // for the flights with no stand, read out rather than filtered onto the board.
  if (/\b(unassigned|un-?allocated|no stands?|without (a )?stands?|(do|does)n'?t have (a )?stands?)\b/.test(normalized)) {
    return action("find_flights", { query: "no stand" });
  }
  if (LIST_ALL_CUE.test(normalized)) return action("list_alerts");
  if (CONFLICT_CUE.test(normalized) && !/\balerts?\b/.test(normalized)) return action("list_conflicts");
  if (/\balerts?\b/.test(normalized) || /needs?\s+attention/.test(normalized)) return action("brief");
  if (/\b(find|search|look\s+for|where\s+is)\b/.test(normalized)) {
    const candidate = normalized.match(/\b(?:find|search\s+for|search|look\s+for|where\s+is)\s+([a-z0-9][a-z0-9 ]{1,20})/);
    const query = candidate?.[1]?.trim();
    if (query) return action("find_flights", { query });
  }

  return {
    kind: "unclear",
    hint: "I can select flights, change the view or filters, and read out the demo alerts. Name a flight number or a view.",
  };
}

/**
 * The only interpreter shipped today. See the header: bounded phrase matching,
 * reported as such, with "unclear" rather than a guess.
 */
export const phraseInterpreter: RequestInterpreter = {
  id: "phrase-matcher",
  // Synchronous and local, so there is nothing for `signal` to abort. It also
  // ignores transcript and task history, which is precisely why it cannot
  // handle corrections or follow-ups.
  interpret(request) {
    return Promise.resolve(interpretPhrase(request.utterance, request.snapshot, request.taskHistory));
  },
};

/**
 * Puts the area-closure request ahead of `inner`, so it is understood the
 * same way every time, whichever interpreter is in use and whether or not
 * its backend is reachable. Anything else goes to `inner` unchanged.
 *
 * DEV NOTE (demo): this exists so the multi-cursor demo plays reliably in
 * front of people (see docs/multi-agent-demo.md). It bypasses the
 * interpreter model for that one phrasing, which the backend interpreter
 * could also choose on its own (close_area is in its schema). Remove it once
 * the multi-agent concept is settled and the model path is trusted for it.
 */
export function withDemoShortcuts(inner: RequestInterpreter): RequestInterpreter {
  return {
    id: `${inner.id}+demo-shortcuts`,
    interpret(request, signal) {
      const closing = matchAreaClosure(request.utterance);
      return closing ? Promise.resolve(action("close_area", closing)) : inner.interpret(request, signal);
    },
  };
}

/** The spoken vocabulary hint used when a request cannot be interpreted. */
export const SUPPORTED_REQUEST_SUMMARY =
  `Mica's voice control can select a flight by number, or several together, move a stay to another stand or swap two, ` +
  `give a stand to flights that have none or take a flight off its stand, ` +
  `close a stand area for a while and move everything on it elsewhere (for example "Pier B is closed from 9 to 1"), ` +
  `suggest the move that most widens the tightest gap between stays, switch between the views ` +
  `(${VIEWS.map((view) => view.label).join(", ")}), set or reset the carrier, stand-area and aircraft-type filters, ` +
  `give a rundown of what is open and where to start, read out the demo alerts or the conflicts from late stays, and acknowledge or reopen alerts. It cannot change any schedule.`;
