import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import { ACTIVE_DATASET, activateAccommodationWorkspace, initializeActiveDataset, requireStandEditing } from "../src/operations/activeDataset.ts";
import { parseAccommodation } from "../src/overlays/accommodation.ts";
import { parseGateWaitProfile } from "../src/overlays/profiles.ts";

const reference = await loadSourceDataset({ source: "contoso", plan: "baseline" });
initializeActiveDataset(reference);
const workspace = await import("../src/operations/accommodationSession.ts");
const records = await import("../src/operations/operationsData.ts");
const chart = await import("../src/stand-timeline-demo/demoData.ts");
const allocation = await import("../src/operations/allocation.ts");
const { buildSnapshot } = await import("../src/live/opsHost.ts");
const { EMPTY_FILTERS } = await import("../src/operations/opsFilters.ts");
await import("../src/operations/skyeReview.ts");
const { outputs } = await import("../src/operations/outputs.ts");
const guests = await import("../src/live/callGuests.ts");
const alerts = await import("../src/operations/skyeAlerts.ts");
const evidence = parseAccommodation(reference.overlays!.profiles.accommodation);
const waiting = parseGateWaitProfile(reference.overlays!.profiles["gate-wait"]);

test("session transitions publish coherent chart, lists, allocation and agent records before notifying consumers", () => {
  const before = structuredClone(reference);
  let notifications = 0, cancellations = 0;
  const unsubscribe = workspace.subscribeAccommodationSession(() => {
    notifications++;
    const active = workspace.accommodationSession().active;
    assert.strictEqual(ACTIVE_DATASET, active);
    assert.strictEqual(chart.DEMO_DATA, active.timeline);
    assert.strictEqual(records.OPS_FLIGHTS, active.flights);
    assert.strictEqual(records.OPS_FLIGHTS_BY_ID, active.flightsById);
    assert.strictEqual(records.ARRIVALS, active.arrivals);
    assert.strictEqual(records.DEPARTURES, active.departures);
    assert.strictEqual(records.NO_STAND_STAYS, active.noStandStays);
    assert.deepEqual(allocation.offBoardStays(), active.noStandStays);
    for (const stay of active.timeline.occupancies) {
      assert.strictEqual(allocation.occupancyById(stay.id), stay);
      assert.equal(allocation.standState().stays.get(stay.id)?.rowId, stay.rowId);
      assert.equal(allocation.planState().stays.get(stay.id)?.rowId, stay.rowId);
    }
    for (const flight of active.flights) {
      const stayId = flight.occupancyId ?? flight.unplacedStay?.stayId;
      if (stayId) assert.ok(allocation.flightsAtStay(stayId).includes(flight));
    }
    const snapshot = buildSnapshot({
      revision: workspace.accommodationSession().revision, view: "all", filters: EMPTY_FILTERS,
      acknowledged: new Set(), selection: {
        occupancyIds: [], flightId: workspace.accommodationSession().accepted ? evidence.request.flights[0].id : null,
      },
    });
    assert.equal(snapshot.totalFlights, active.flights.length);
    assert.equal(snapshot.matchingFlights, active.flights.length);
    assert.equal(snapshot.selection.flightNumber, workspace.accommodationSession().accepted ? evidence.request.visit.arrFlight : null);
    assert.deepEqual(snapshot.callGuests, []);
    assert.deepEqual(snapshot.callingGuests, []);
    assert.equal(alerts.skyeAlerts(), null);
    assert.deepEqual(outputs(), [], "session accommodation is not a stand-edit approval or operational output");
  });
  const cancel = workspace.beforeAccommodationChange(() => {
    cancellations++;
    assert.strictEqual(ACTIVE_DATASET, workspace.accommodationSession().active, "cancel old work before replacing records");
  });
  const version = allocation.allocationVersion(), planVersion = allocation.planVersion();
  for (const option of evidence.variants.baseline.options.slice(0, 2)) {
    guests.inviteToCall(guests.PEOPLE[0]);
    alerts.showSkyeAlerts("stale-reference-alert");
    workspace.chooseSessionAccommodation({
      type: "accept", optionId: option.id, assumptionId: waiting.default_assumption_id, confirmed: true,
    });
    assert.strictEqual(records.OPS_FLIGHTS_BY_ID.get(evidence.request.flights[0].id),
      records.ARRIVALS.find(flight => flight.id === evidence.request.flights[0].id));
    assert.throws(requireStandEditing, /read.only/i);
    assert.throws(() => initializeActiveDataset(reference), /reload/i);
  }
  const accepted = workspace.accommodationSession();
  assert.throws(() => workspace.chooseSessionAccommodation({
    type: "accept", optionId: "unknown", assumptionId: waiting.default_assumption_id, confirmed: true,
  }), /Unknown/);
  assert.strictEqual(workspace.accommodationSession(), accepted);
  assert.equal(notifications, 2);
  assert.equal(cancellations, 2);
  assert.throws(() => activateAccommodationWorkspace(reference, { ...accepted.active, airportId: "another" }), /cannot change/);
  assert.throws(() => activateAccommodationWorkspace(reference, { ...accepted.active, overlays: reference.overlays }), /reference analysis/);
  assert.strictEqual(ACTIVE_DATASET, accepted.active);
  workspace.chooseSessionAccommodation({ type: "restore" });
  assert.equal(notifications, 3);
  assert.equal(cancellations, 3);
  assert.equal(allocation.allocationVersion(), version + 3);
  assert.equal(allocation.planVersion(), planVersion + 3);
  assert.strictEqual(ACTIVE_DATASET, reference);
  assert.deepEqual(ACTIVE_DATASET, before);
  assert.equal(allocation.occupancyById(evidence.request.stay_id), undefined);
  assert.equal(records.OPS_FLIGHTS_BY_ID.has(evidence.request.flights[0].id), false);
  unsubscribe();
  cancel();
});
