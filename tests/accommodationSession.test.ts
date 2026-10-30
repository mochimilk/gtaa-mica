import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import { createOperationsDataset } from "../src/operations/dataset.ts";
import { createFixtureDataset } from "../src/stand-timeline-demo/fixtureDataset.ts";
import { accommodateDataset, accommodationImpact, parseAccommodation } from "../src/overlays/accommodation.ts";
import { changeAccommodationSession, createAccommodationSession } from "../src/overlays/accommodationSession.ts";
import { parseBufferProfile, parseGateWaitProfile } from "../src/overlays/profiles.ts";
import { availableOverlays } from "../src/overlays/registry.ts";
import { gateWaiting, standHandovers } from "../src/overlays/handovers.ts";

for (const scenario of ["comfortable", "constrained", "full-day"]) {
  for (const plan of ["baseline", "tow-options"] as const) {
    test(`${scenario}/${plan}: acceptance, replacement and exact restore retain one consistent, protected workspace`, async () => {
      const reference = await loadSourceDataset({ source: "contoso", scenario, plan });
      const before = structuredClone(reference);
      const evidence = parseAccommodation(reference.overlays!.profiles.accommodation);
      const waiting = parseGateWaitProfile(reference.overlays!.profiles["gate-wait"]);
      const initial = createAccommodationSession(reference);
      let state = initial;
      assert.strictEqual(changeAccommodationSession(initial, { type: "restore" }), initial);
      for (const option of evidence.variants[plan].options) {
        state = changeAccommodationSession(state, {
          type: "accept", optionId: option.id, assumptionId: waiting.default_assumption_id, confirmed: true,
        });
        const active = state.active;
        assert.strictEqual(state.reference, reference);
        assert.equal(active.flights.length, reference.flights.length + 2);
        assert.equal(active.timeline.visits.length, reference.timeline.visits.length + 1);
        assert.equal(active.timeline.turnsById.size, reference.timeline.turnsById.size + 1);
        assert.equal(active.timeline.occupancies.length, reference.timeline.occupancies.length + 1);
        assert.deepEqual(active.timeline.stayPosition.get(evidence.request.stay_id), { index: 0, count: 1 });
        assert.deepEqual(active.noStandStays, reference.noStandStays);
        assert.deepEqual(active.timeline.delays, reference.timeline.delays);
        assert.deepEqual(active.capabilities, { editStands: false, fixtureAnalyses: false });
        assert.equal(active.preparedPlan, undefined);
        assert.deepEqual(Object.keys(active.overlays!.profiles), ["buffers", "gate-wait"]);
        assert.equal(active.overlays!.datasetId, active.id);
        assert.equal(active.overlays!.companions, undefined);
        assert.deepEqual(availableOverlays(active).map(item => item.id), ["buffers", "gate-wait"]);
        const buffer = parseBufferProfile(active.overlays!.profiles.buffers);
        const localWaiting = parseGateWaitProfile(active.overlays!.profiles["gate-wait"]);
        const assumption = localWaiting.assumptions.find(item => item.id === localWaiting.default_assumption_id)!;
        const impact = accommodationImpact(reference, evidence, option.id, buffer, assumption);
        assert.equal(standHandovers(active.timeline.occupancies, active.domain).handovers.length, impact.afterBuffers.handovers);
        assert.deepEqual(gateWaiting(active, assumption), impact.afterWaiting);
        assert.match(active.label, /Session accommodation/);
        assert.match(active.summary!, /not a new solver plan or operational approval/);
        assert.doesNotThrow(() => createOperationsDataset(active));
        assert.deepEqual(active.flights.slice(0, reference.flights.length).map(({ standId: _, ...flight }) => flight),
          reference.flights.map(({ standId: _, ...flight }) => flight));
        for (const flight of active.flights) assert.strictEqual(active.flightsById.get(flight.id), flight);
        for (const stay of reference.timeline.occupancies) {
          const next = active.timeline.occupancies.find(item => item.id === stay.id)!;
          assert.deepEqual({ ...next, rowId: stay.rowId }, stay);
          assert.equal(next.rowId, option.moves.find(move => move.stay_id === stay.id)?.to_stand_id ?? stay.rowId);
          assert.deepEqual(active.timeline.endpoints.get(stay.id), reference.timeline.endpoints.get(stay.id));
        }
        assert.deepEqual(reference, before);
      }
      const restored = changeAccommodationSession(state, { type: "restore" });
      assert.strictEqual(restored.active, reference);
      assert.equal(restored.accepted, null);
      assert.ok(restored.revision > state.revision);
      assert.deepEqual(initial, { reference, active: reference, accepted: null, revision: 0 });
    });
  }
}

test("invalid decisions and stale evidence leave an accepted session untouched", async () => {
  const reference = await loadSourceDataset({ source: "contoso", plan: "baseline" });
  const evidence = parseAccommodation(reference.overlays!.profiles.accommodation);
  const waiting = parseGateWaitProfile(reference.overlays!.profiles["gate-wait"]);
  const action = {
    type: "accept" as const, optionId: evidence.variants.baseline.options[0].id,
    assumptionId: waiting.default_assumption_id, confirmed: true,
  };
  const state = changeAccommodationSession(createAccommodationSession(reference), action);
  const before = structuredClone(state);
  for (const invalid of [
    { ...action, optionId: "unknown" }, { ...action, assumptionId: "unknown" }, { ...action, confirmed: false },
  ]) assert.throws(() => changeAccommodationSession(state, invalid));
  assert.strictEqual(changeAccommodationSession(state, action), state);
  const differentAssumption = waiting.assumptions.find(item => item.id !== action.assumptionId)!;
  const changedAssumption = changeAccommodationSession(state, { ...action, assumptionId: differentAssumption.id });
  assert.equal(parseGateWaitProfile(changedAssumption.active.overlays!.profiles["gate-wait"]).default_assumption_id, differentAssumption.id);
  assert.equal(parseGateWaitProfile(reference.overlays!.profiles["gate-wait"]).default_assumption_id, waiting.default_assumption_id);
  const stale = structuredClone(evidence);
  stale.variants.baseline.request_fingerprint = "0".repeat(64);
  assert.throws(() => accommodateDataset(reference, stale, action.optionId), /read-only dataset/);
  assert.deepEqual(state, before);
  assert.throws(() => changeAccommodationSession(createAccommodationSession(createFixtureDataset()), action), /no validated/);
  const blocked = structuredClone(reference);
  const none = parseAccommodation(blocked.overlays!.profiles.accommodation);
  none.variants.baseline.options = [];
  none.variants.baseline.total_options_found = 0;
  none.variants.baseline.status = "no-acceptable-option-found";
  const noOptions = { ...blocked, overlays: {
    ...blocked.overlays!, profiles: { ...blocked.overlays!.profiles, accommodation: none },
  } };
  assert.throws(() => changeAccommodationSession(createAccommodationSession(noOptions), action), /Unknown/);
});
