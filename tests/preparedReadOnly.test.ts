import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { adaptPreparedSchedule } from "../src/data-sources/preparedAdapter.ts";
import { ACTIVE_DATASET, initializeActiveDataset } from "../src/operations/activeDataset.ts";

const dataset = adaptPreparedSchedule(
  JSON.parse(readFileSync(new URL("../src/data-sources/prepared/contoso/full-day.json", import.meta.url), "utf8")),
  { airportId: "contoso", caseId: "full-day" }, "baseline",
);
initializeActiveDataset(dataset);
const allocation = await import("../src/operations/allocation.ts");
const { validateAppAction, applyAppAction } = await import("../src/live/appActions.ts");
const { currentAlerts } = await import("../src/operations/boardAlerts.ts");
const { phraseInterpreter, withDemoShortcuts } = await import("../src/live/requestInterpreter.ts");
const { buildSnapshot, describeSnapshot } = await import("../src/live/opsHost.ts");
const { EMPTY_FILTERS } = await import("../src/operations/opsFilters.ts");

test("prepared source is installed before compatibility consumers and cannot be replaced later", async () => {
  assert.equal(ACTIVE_DATASET, dataset);
  assert.equal((await import("../src/operations/operationsData.ts")).OPS_FLIGHTS, dataset.flights);
  assert.equal((await import("../src/stand-timeline-demo/demoData.ts")).DEMO_DATA, dataset.timeline);
  assert.throws(() => initializeActiveDataset(dataset), /page reload/);
});

test("direct stand mutations explicitly reject prepared sources without changing data", () => {
  const before = structuredClone(dataset);
  const stay = dataset.timeline.occupancies[0];
  const calls = [
    () => allocation.applyPlan({ kind: "move", occupancyId: stay.id, standId: stay.rowId }),
    () => allocation.applyAssigns([]),
    () => allocation.unassignStays([stay.id]),
    () => allocation.resetStands(),
    () => allocation.restoreStays(new Map()),
    () => allocation.setClosure(null),
    () => allocation.setRunningLate(stay.id, 2, 2),
    () => allocation.planAreaClosure("A", stay.start, stay.end),
    () => allocation.suggestBest(stay.id),
  ];
  for (const call of calls) assert.throws(call, /read-only/);
  assert.deepEqual(dataset, before);
  assert.equal(allocation.planDrop(stay.id, stay.rowId).kind, "conflict");
  assert.equal(allocation.checkSwap(stay.id, dataset.timeline.occupancies[1].id).ok, false);
  assert.equal(allocation.planAssign([dataset.noStandStays[0].id]).assigns.length, 0);
  assert.equal(allocation.aircraftSize(stay), undefined);
  assert.equal(allocation.allocationVersion(), 0);
});

test("agents refuse stand edits and unsupported analyses while still allowing browsing", () => {
  for (const name of ["move_stay", "swap_stays", "close_area", "assign_stands", "unassign_stands", "fix_all", "resolve_disruption", "suggest_move", "explain_plan", "list_conflicts"]) {
    const result = validateAppAction(name);
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.match(result.code, /read_only_source|unsupported_analysis/);
  }
  assert.equal(validateAppAction("set_view", { view: "arrivals" }).ok, true);
  assert.equal(validateAppAction("select_flight", { flightId: dataset.flights[0].id }).ok, true);
  const snapshot = buildSnapshot({
    revision: 0, view: "all", filters: EMPTY_FILTERS,
    selection: { flightId: null, occupancyIds: [] }, acknowledged: new Set(),
  });
  assert.match(describeSnapshot(snapshot), /read-only scheduled UTC/);
  const host = new Proxy({}, { get: () => { throw new Error("Read-only refusal must happen before any host mutation."); } });
  // A deliberately stale, prevalidated action must be refused at application too.
  const refused = applyAppAction(
    { name: "move_stay", flightId: dataset.flights[0].id, standId: dataset.stands[0].code },
    host as Parameters<typeof applyAppAction>[1], [],
  );
  assert.equal(refused.ok, false);
  const brief = applyAppAction({ name: "brief" }, host as Parameters<typeof applyAppAction>[1], []);
  assert.ok(brief.ok && !brief.mutated && !brief.proposal);
  if (brief.ok) assert.match(brief.spoken, /298\/320.*not operational certification/);
});

test("phrase requests explicitly refuse source edits and can still change views", async () => {
  const snapshot = buildSnapshot({
    revision: 0, view: "all", filters: EMPTY_FILTERS,
    selection: { flightId: null, occupancyIds: [] }, acknowledged: new Set(),
  });

  for (const utterance of ["move this flight to A1", "assign all unassigned flights", "suggest a better stand", "explain the plan"]) {
    const result = await phraseInterpreter.interpret({ utterance, snapshot, transcript: "", taskHistory: [] });
    assert.equal(result.kind, "unsupported", utterance);
  }
  const result = await phraseInterpreter.interpret({ utterance: "show arrivals", snapshot, transcript: "", taskHistory: [] });
  assert.equal(result.kind, "action");
});

test("main's demo shortcuts preserve prepared-source refusals and the configured browsing interpreter", async () => {
  const snapshot = buildSnapshot({
    revision: 0, view: "all", filters: EMPTY_FILTERS,
    selection: { flightId: null, occupancyIds: [] }, acknowledged: new Set(),
  });
  let interpreted = 0;
  const interpreter = withDemoShortcuts({
    id: "prepared-browsing",
    interpret: async request => {
      interpreted++;
      return phraseInterpreter.interpret(request);
    },
  });
  for (const utterance of ["close Pier B from 09:00 to 13:00", "assign all unassigned flights", "explain the plan"]) {
    const result = await interpreter.interpret({ utterance, snapshot, transcript: "", taskHistory: [] });
    assert.equal(result.kind, "unsupported", utterance);
  }
  const result = await interpreter.interpret({
    utterance: "show arrivals", snapshot, transcript: "", taskHistory: [],
  });
  assert.ok(result.kind === "action" && result.action.name === "set_view" && result.action.view === "arrivals");
  assert.ok(interpreted > 0, "ordinary browsing must still reach the configured interpreter");
});

test("source alerts contain real waiting flights but no fixture notices or disruptions", async () => {
  const alerts = currentAlerts();
  assert.equal(alerts.length, 22);
  assert.ok(alerts.every(alert => alert.kind === "no_stand" && dataset.flightsById.has(alert.flightId)));
  const { landDisruption, planDisruption } = await import("../src/operations/disruption.ts");
  assert.throws(() => landDisruption(), /Fixture-only/);
  assert.throws(() => planDisruption(), /Fixture-only/);
  const { boardKpis } = await import("../src/operations/boardKpis.ts");
  assert.throws(() => boardKpis(allocation.standState()), /Fixture-only/);
});

test("prepared views and filters retain source carrier, aircraft and unassigned visit relationships", async () => {
  const { makeMatcher, FILTER_OPTIONS, UNASSIGNED_AREA } = await import("../src/operations/opsFilters.ts");
  const arrivals = makeMatcher("arrivals", EMPTY_FILTERS, new Set());
  assert.equal(dataset.flights.filter(arrivals.flight).length, 160);
  const waiting = makeMatcher("all", { ...EMPTY_FILTERS, area: [UNASSIGNED_AREA] }, new Set());
  assert.equal(dataset.flights.filter(waiting.flight).length, 22);
  assert.ok(dataset.noStandStays.every(stay => waiting.occupancy(stay.id)));
  const subject = dataset.flights[0];
  const visit = dataset.timeline.turnsById.get(subject.visitId!)!;
  assert.ok(FILTER_OPTIONS.carrier.includes(visit.carrier));
  assert.ok(FILTER_OPTIONS.type.includes(subject.aircraftType!));
  const carrier = makeMatcher("all", { ...EMPTY_FILTERS, carrier: [visit.carrier] }, new Set());
  assert.ok(carrier.flight(subject));
  assert.ok(carrier.occupancy(subject.occupancyId!));
});
