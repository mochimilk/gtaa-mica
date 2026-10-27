// The renderer side of interpretation: a model decision is re-validated
// against the real fixture before it can reach the app.
import assert from "node:assert/strict";
import test from "node:test";
import { createBackendInterpreter, decisionToRequest, resolveInterpreter } from "../src/live/backendInterpreter.ts";
import { phraseInterpreter, type InterpretationRequest } from "../src/live/requestInterpreter.ts";
import { buildSnapshot } from "../src/live/opsHost.ts";
import { EMPTY_FILTERS } from "../src/operations/opsFilters.ts";

const snapshot = (over: Partial<Parameters<typeof buildSnapshot>[0]> = {}) =>
  buildSnapshot({
    revision: 7,
    view: "all",
    filters: EMPTY_FILTERS,
    acknowledged: new Set<string>(),
    selection: { occupancyIds: [], flightId: null },
    ...over,
  });

const request = (over: Partial<InterpretationRequest> = {}): InterpretationRequest => ({
  utterance: "select XA101",
  snapshot: snapshot(),
  transcript: "User: select XA101",
  taskHistory: [],
  ...over,
});

const args = (over: Record<string, unknown> = {}) => ({
  flightId: null,
  flightIds: null,
  mode: null,
  alertId: null,
  view: null,
  dimension: null,
  values: null,
  query: null,
  direction: null,
  ...over,
});

const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

test("a valid decision becomes a validated action", () => {
  const result = decisionToRequest({
    kind: "action",
    action_name: "select_flight",
    args: args({ flightId: "T01-ARR" }),
    reason: null,
    hint: null,
  });
  assert.deepEqual(result, { kind: "action", action: { name: "select_flight", flightId: "T01-ARR" } });
});

test("a multi-flight decision keeps its order and mode", () => {
  const result = decisionToRequest({
    kind: "action",
    action_name: "select_flights",
    args: args({ flightIds: ["T03-ARR", "T01-ARR"], mode: "add" }),
    reason: null,
    hint: null,
  });
  assert.deepEqual(result, {
    kind: "action",
    action: { name: "select_flights", flightIds: ["T03-ARR", "T01-ARR"], mode: "add" },
  });
  const ghost = decisionToRequest({
    kind: "action",
    action_name: "select_flights",
    args: args({ flightIds: ["T01-ARR", "GHOST-1"], mode: "replace" }),
    reason: null,
    hint: null,
  });
  assert.equal(ghost.kind, "unclear");
});

test("a hallucinated identifier is refused, not applied", () => {
  // The decisive guard: the schema cannot know the fixture, so the renderer
  // checks every identifier itself.
  for (const bad of [
    { action_name: "select_flight", args: args({ flightId: "GHOST-1" }) },
    { action_name: "acknowledge_alert", args: args({ alertId: "ALERT-GHOST" }) },
    { action_name: "set_filter", args: args({ dimension: "carrier", values: ["ZZ"] }) },
    { action_name: "set_view", args: args({ view: "nonsense" }) },
    // Right action, missing argument.
    { action_name: "select_flight", args: args() },
    { action_name: "set_filter", args: args({ dimension: "carrier" }) },
  ]) {
    const result = decisionToRequest({ kind: "action", ...bad, reason: null, hint: null });
    assert.equal(result.kind, "unclear", `${JSON.stringify(bad)} should not have been accepted`);
  }
});

test("a malformed decision never becomes an action", () => {
  for (const decision of [
    {},
    { kind: "action" },
    { kind: "action", action_name: "constructor", args: args() },
    { kind: "action", action_name: "__proto__", args: args() },
    { kind: "action", action_name: "drop_everything", args: args() },
    { kind: "nonsense" },
    { kind: "action", action_name: "select_flight", args: null },
  ]) {
    const result = decisionToRequest(decision);
    assert.notEqual(result.kind, "action", `${JSON.stringify(decision)} should not have been accepted`);
  }
});

test("unsupported and unclear decisions carry their wording through", () => {
  const unsupported = decisionToRequest({ kind: "unsupported", reason: "Mica cannot assign stands." });
  assert.deepEqual(unsupported, { kind: "unsupported", reason: "Mica cannot assign stands." });

  const unclear = decisionToRequest({ kind: "unclear", hint: "Which flight did you mean?" });
  assert.deepEqual(unclear, { kind: "unclear", hint: "Which flight did you mean?" });

  // Missing wording still produces something sayable.
  assert.match((decisionToRequest({ kind: "unclear" }) as { hint: string }).hint, /\S/);
  assert.match((decisionToRequest({ kind: "unsupported" }) as { reason: string }).reason, /\S/);
});

test("the request carries the board vocabulary, history and revision", async () => {
  let body: Record<string, unknown> = {};
  const interpreter = createBackendInterpreter({
    baseUrl: "",
    fetchImpl: (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ revision: 7, decision: { kind: "unclear", hint: "which one?" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch,
  });

  await interpreter.interpret(
    request({
      taskHistory: [{ utterance: "show arrivals", action: "set_view", outcome: "applied", result: "Showing Arrivals." }],
    }),
  );

  assert.equal(body.utterance, "select XA101");
  assert.equal(body.revision, 7);
  assert.match(String(body.transcript), /select XA101/);
  assert.equal((body.taskHistory as unknown[]).length, 1);

  const board = body.board as Record<string, string[] | Record<string, string[]>>;
  // The model picks identifiers from these, so it never has to invent one.
  assert.ok((board.allowedFlights as string[]).some((entry) => entry.startsWith("T01-ARR —")));
  assert.ok((board.openAlerts as string[]).some((entry) => entry.startsWith("ALERT-U01 —")));
  assert.deepEqual((board.allowedFilterValues as Record<string, string[]>).carrier, ["XA", "XB", "XC", "XD"]);
});

test("a chart selection is sent as named flights", async () => {
  let body: Record<string, unknown> = {};
  const interpreter = createBackendInterpreter({
    baseUrl: "",
    fetchImpl: (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ revision: 7, decision: { kind: "unclear", hint: "?" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });

  await interpreter.interpret(
    request({ snapshot: snapshot({ selection: { occupancyIds: ["T01-1"], flightId: null } }) }),
  );

  const selected = (body.board as { selectedFlights: string[] }).selectedFlights;
  // Without this the model could only see a count, and "that flight" would be
  // unresolvable.
  assert.ok(selected.some((entry) => entry.includes("XA101")));
  assert.ok(selected.some((entry) => entry.includes("XA102")));
});

test("a decision for a superseded revision is rejected", async () => {
  const interpreter = createBackendInterpreter({
    baseUrl: "",
    fetchImpl: respond({ revision: 6, decision: { kind: "action", action_name: "clear_selection", args: args() } }),
  });

  const result = await interpreter.interpret(request());
  assert.equal(result.kind, "unclear");
  assert.match((result as { hint: string }).hint, /board changed/i);
});

test("an unconfigured interpreter says so instead of guessing", async () => {
  const interpreter = createBackendInterpreter({
    baseUrl: "",
    fetchImpl: respond(
      { error: { code: "interpreter_not_configured", message: "No MICA_INTERPRETER_MODEL has been chosen." } },
      503,
    ),
  });

  const result = await interpreter.interpret(request());
  // Reported as something Mica cannot do, never downgraded to phrase matching.
  assert.equal(result.kind, "unsupported");
  assert.match((result as { reason: string }).reason, /no interpreter model configured/i);
  assert.match((result as { reason: string }).reason, /nothing was changed/i);
});

test("an unreachable or failing backend is reported, not guessed around", async () => {
  const offline = createBackendInterpreter({
    baseUrl: "",
    fetchImpl: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
  });
  const offlineResult = await offline.interpret(request());
  assert.equal(offlineResult.kind, "unsupported");
  assert.match((offlineResult as { reason: string }).reason, /not reachable/i);

  const broken = createBackendInterpreter({
    baseUrl: "",
    fetchImpl: respond({ error: { code: "upstream_unavailable", message: "Voice actions are unavailable." } }, 502),
  });
  assert.equal((await broken.interpret(request())).kind, "unsupported");

  const garbled = createBackendInterpreter({
    baseUrl: "",
    fetchImpl: (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch,
  });
  assert.equal((await garbled.interpret(request())).kind, "unclear");
});

test("cancellation propagates as an abort, not a spoken answer", async () => {
  const aborter = new AbortController();
  let seenSignal: AbortSignal | null | undefined;

  const interpreter = createBackendInterpreter({
    baseUrl: "",
    fetchImpl: ((_url: string, init: RequestInit) => {
      seenSignal = init.signal;
      aborter.abort();
      return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    }) as unknown as typeof fetch,
  });

  // The executor treats a throw as "stale", so it must not be swallowed.
  await assert.rejects(() => interpreter.interpret(request(), aborter.signal));
  assert.equal(seenSignal, aborter.signal);
});

test("the backend interpreter is the default; phrase mode is explicit", () => {
  assert.equal(resolveInterpreter("phrase", phraseInterpreter).id, "phrase-matcher");
  // Anything else, including unset, uses the real interpreter.
  for (const mode of [undefined, "", "backend", "responses", "nonsense"]) {
    assert.equal(resolveInterpreter(mode, phraseInterpreter).id, "responses-backend");
  }
});
