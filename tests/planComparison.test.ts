import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import { adaptPreparedSchedule } from "../src/data-sources/preparedAdapter.ts";
import { parsePlanComparison, preparePlanComparison, validatePlanComparisonDataset } from "../src/data-sources/planComparison.ts";
import type { PlanVariant, PreparedPlan, PreparedScenario } from "../src/data-sources/preparedTypes.ts";
import { createOperationsDataset } from "../src/operations/dataset.ts";
import { buildPlanComparison } from "../src/overlays/planComparison.ts";
import { buildDecisionSummary } from "../src/overlays/decisionSummary.ts";
import { fingerprintJson } from "../src/overlays/capacity.ts";
import { commonWaiting, gateWaiting, standHandovers } from "../src/overlays/handovers.ts";
import { parseBufferProfile, parseGateWaitProfile } from "../src/overlays/profiles.ts";
import { availableOverlays } from "../src/overlays/registry.ts";

const source = await loadSourceDataset({ source: "contoso", plan: "baseline" });
const evidence = parsePlanComparison(source.overlays!.companions!["plan-comparison"]);
const minute = 60_000;

function smallSnapshot(): PreparedScenario {
  const snapshot: PreparedScenario = JSON.parse(readFileSync(new URL("../src/data-sources/prepared/contoso/full-day.json", import.meta.url), "utf8"));
  snapshot.airport = { id: "example", name: "Example", time_zone: "UTC" };
  snapshot.case_id = "constrained";
  snapshot.demand_id = "example:constrained";
  snapshot.rows = snapshot.rows.slice(0, 3);
  snapshot.visits = snapshot.visits.slice(0, 4);
  snapshot.flights = snapshot.flights.filter(flight => snapshot.visits.some(visit => visit.turnId === flight.visitId));
  const times = [[60, 120], [140, 300], [310, 360], [380, 430]];
  const time = (minutes: number) => new Date(Date.parse(snapshot.plan_window.start) + minutes * minute).toISOString();
  for (const [index, visit] of snapshot.visits.entries()) {
    for (const flight of snapshot.flights.filter(item => item.visitId === visit.turnId)) {
      flight.scheduled = time(times[index][flight.direction === "arrival" ? 0 : 1]);
    }
  }
  const stay = (index: number, id: string): PreparedPlan["stays"][number] => ({
    id, visitId: snapshot.visits[index].turnId, rowId: snapshot.rows[0].id,
    start: time(times[index][0]), end: time(times[index][1]), towIn: false, towOut: false,
    arrivalFlightId: snapshot.flights.find(flight => flight.visitId === snapshot.visits[index].turnId && flight.direction === "arrival")!.id,
    departureFlightId: snapshot.flights.find(flight => flight.visitId === snapshot.visits[index].turnId && flight.direction === "departure")!.id,
  });
  snapshot.variants.baseline = {
    ...snapshot.variants.baseline, covered_flight_count: 6, generated_movement_count: 0,
    stays: [stay(0, "base-v0"), stay(1, "base-v1"), stay(3, "base-v3")],
  };
  const { departureFlightId: _departure, ...first } = stay(1, "tow-v1-arr");
  const { arrivalFlightId: _arrival, ...last } = stay(1, "tow-v1-dep");
  snapshot.variants["tow-options"] = {
    ...snapshot.variants["tow-options"], covered_flight_count: 6, generated_movement_count: 2,
    stays: [
      stay(0, "tow-v0"), { ...first, end: time(180), towOut: true },
      { id: "tow-v1-hold", visitId: first.visitId, rowId: snapshot.rows[2].id,
        start: time(190), end: time(240), towIn: true, towOut: true },
      { ...last, start: time(250), towIn: true }, stay(2, "tow-v2"),
    ],
  };
  return snapshot;
}

async function smallDataset(variant: PlanVariant = "baseline", analyses = true, snapshot = smallSnapshot()) {
  const dataset = adaptPreparedSchedule(snapshot, { airportId: "example", caseId: "constrained" }, variant);
  const profile = { ...buildDecisionSummary(source).profile, id: "example:decision-review" };
  return createOperationsDataset({
    ...dataset, overlays: {
      airportId: dataset.airportId, datasetId: dataset.id, profiles: {
        "decision-review": profile,
        ...(analyses ? {
          buffers: { ...parseBufferProfile(source.overlays!.profiles.buffers), id: "example:buffers" },
          "gate-wait": { ...parseGateWaitProfile(source.overlays!.profiles["gate-wait"]), id: "example:waiting" },
        } : {}),
      },
      companions: { "plan-comparison": await preparePlanComparison(snapshot) },
    },
  });
}

test("full-day comparison measures both plans, without inventing differences from assignment IDs or request hashes", async () => {
  for (const variant of ["baseline", "tow-options"] as const) {
    const dataset = await loadSourceDataset({ source: "contoso", plan: variant });
    const comparison = buildPlanComparison(dataset)!;
    assert.equal(comparison.reference.variant, variant);
    assert.equal(comparison.alternative.variant, variant === "baseline" ? "tow-options" : "baseline");
    for (const result of [comparison.reference, comparison.alternative]) {
      assert.equal(result.coverage.assignedVisits, 149);
      assert.equal(result.coverage.unassignedVisits, 11);
      assert.equal(result.coverage.assignedFlightLegs, 298);
      assert.equal(result.coverage.contextFlightLegs, 0);
      assert.equal(result.generatedMovements, 0);
      assert.deepEqual(result.buffers, buildDecisionSummary(dataset).reference.buffers);
    }
    assert.equal(comparison.retainedIds.length, 149);
    assert.deepEqual(comparison.gainedIds, []);
    assert.deepEqual(comparison.lostIds, []);
    assert.deepEqual(comparison.changedIds, []);
    assert.deepEqual(comparison.changes, []);
    assert.equal(comparison.commonArrivals, 105);
    assert.equal(comparison.beforeCommonMinutes, 92);
    assert.equal(comparison.afterCommonMinutes, 92);
    assert.equal(comparison.snapshotFingerprint, await fingerprintJson(evidence.snapshot));
  }
});

test("comparison distinguishes gained, lost, retained and changed visits, preserving complete multi-stand tow chains", async () => {
  const snapshot = smallSnapshot(), dataset = await smallDataset("baseline", true, snapshot);
  const result = buildPlanComparison(dataset)!;
  assert.deepEqual(result.retainedIds.sort(), snapshot.visits.slice(0, 2).map(visit => visit.turnId).sort());
  assert.deepEqual(result.gainedIds, [snapshot.visits[2].turnId]);
  assert.deepEqual(result.lostIds, [snapshot.visits[3].turnId]);
  assert.deepEqual(result.changedIds, [snapshot.visits[1].turnId]);
  assert.equal(result.reference.generatedMovements, 0);
  assert.equal(result.alternative.generatedMovements, 2);
  assert.equal(result.reference.coverage.assignedVisits, 3);
  assert.equal(result.alternative.coverage.assignedVisits, 3);
  assert.equal(result.alternative.coverage.assignedFlightLegs, 6);
  assert.equal(result.changes.length, 3);
  const changed = result.changes.find(change => change.kind === "changed-assignment")!;
  assert.equal(changed.beforeStays.length, 1);
  assert.equal(changed.afterStays.length, 3);
  assert.deepEqual(changed.afterStays.map(stay => [stay.towIn, stay.towOut]), [[false, true], [true, true], [true, false]]);
  assert.equal(changed.flights.length, 2);
  for (const flight of changed.flights) assert.equal(flight.estimate, Date.parse(snapshot.flights.find(item => item.id === flight.id)!.scheduled));
  assert.equal(result.changes.find(change => change.kind === "newly-assigned")!.beforeStays.length, 0);
  assert.equal(result.changes.find(change => change.kind === "now-unassigned")!.afterStays.length, 0);
});

test("additional coverage is counted as visits and source legs, never as the number of tow stays", async () => {
  const snapshot = smallSnapshot();
  snapshot.variants.baseline.stays = snapshot.variants.baseline.stays.filter(stay => stay.visitId !== snapshot.visits[3].turnId);
  snapshot.variants.baseline.covered_flight_count = 4;
  const result = buildPlanComparison(await smallDataset("baseline", true, snapshot))!;
  assert.equal(result.reference.coverage.assignedVisits, 2);
  assert.equal(result.alternative.coverage.assignedVisits, 3);
  assert.equal(result.reference.coverage.assignedFlightLegs, 4);
  assert.equal(result.alternative.coverage.assignedFlightLegs, 6);
  assert.equal(result.gainedIds.length, 1);
  assert.equal(result.lostIds.length, 0);
  assert.equal(result.alternative.generatedMovements, 2);
});

test("reversing the active plan reverses gains, losses and movement differences, not source demand", async () => {
  const forward = buildPlanComparison(await smallDataset())!;
  const backward = buildPlanComparison(await smallDataset("tow-options"))!;
  assert.deepEqual(backward.gainedIds, forward.lostIds);
  assert.deepEqual(backward.lostIds, forward.gainedIds);
  assert.deepEqual(backward.changedIds, forward.changedIds);
  assert.deepEqual(backward.reference, forward.alternative);
  assert.deepEqual(backward.alternative, forward.reference);
  assert.equal(backward.beforeCommonMinutes, forward.afterCommonMinutes);
  assert.equal(backward.afterCommonMinutes, forward.beforeCommonMinutes);
});

test("both plans use the same source threshold and waiting assumption, comparing only common assessed arrivals", async () => {
  const dataset = await smallDataset(), result = buildPlanComparison(dataset, "stressed")!;
  const input = parsePlanComparison(dataset.overlays!.companions!["plan-comparison"]);
  const plans = validatePlanComparisonDataset(input, dataset, dataset.overlays!.profiles).plans;
  const waiting = parseGateWaitProfile(dataset.overlays!.profiles["gate-wait"]).assumptions.find(item => item.id === "stressed")!;
  const before = gateWaiting(plans.baseline, waiting), after = gateWaiting(plans["tow-options"], waiting);
  assert.deepEqual({ commonArrivals: result.commonArrivals, beforeCommonMinutes: result.beforeCommonMinutes,
    afterCommonMinutes: result.afterCommonMinutes }, commonWaiting(before, after));
  assert.equal(result.commonArrivals, 1);
  assert.equal(result.reference.waiting!.assessed, 2);
  assert.equal(result.alternative.waiting!.assessed, 2);
  const gap = standHandovers(plans.baseline.timeline.occupancies, plans.baseline.domain);
  assert.equal(result.reference.buffers!.minimum, Math.min(...gap.handovers.map(item => item.minutes)));
  const strict = createOperationsDataset({ ...dataset, overlays: {
    ...dataset.overlays!, profiles: { ...dataset.overlays!.profiles, buffers: {
      ...parseBufferProfile(dataset.overlays!.profiles.buffers), threshold_minutes: 20,
    } },
  } });
  assert.equal(buildPlanComparison(strict)!.reference.buffers!.tight, 0);
  assert.throws(() => buildPlanComparison(dataset, "unknown"), /Unknown/);
});

test("optional models remain unassessed and empty common populations never become zero waiting", async () => {
  const dataset = await smallDataset("baseline", false), result = buildPlanComparison(dataset)!;
  assert.equal(result.reference.buffers, null);
  assert.equal(result.alternative.buffers, null);
  assert.equal(result.reference.waiting, null);
  assert.equal(result.commonArrivals, 0);
  assert.equal(result.beforeCommonMinutes, null);
  assert.equal(result.afterCommonMinutes, null);
  assert.throws(() => buildPlanComparison(dataset, "routine"), /unavailable/);
  assert.deepEqual(commonWaiting(null, null), { commonArrivals: 0, beforeCommonMinutes: null, afterCommonMinutes: null });
  const snapshot = smallSnapshot();
  snapshot.visits = snapshot.visits.slice(0, 1);
  snapshot.flights = snapshot.flights.filter(flight => flight.visitId === snapshot.visits[0].turnId);
  for (const plan of Object.values(snapshot.variants)) {
    plan.stays = plan.stays.filter(stay => stay.visitId === snapshot.visits[0].turnId);
    plan.covered_flight_count = 2;
    plan.generated_movement_count = 0;
  }
  const empty = buildPlanComparison(await smallDataset("baseline", true, snapshot))!;
  assert.equal(empty.commonArrivals, 0);
  assert.equal(empty.reference.waiting!.totalMinutes, null);
  assert.equal(empty.beforeCommonMinutes, null);
  assert.equal(empty.afterCommonMinutes, null);
});

test("context flight legs are retained in both coverage populations rather than filtered out of the comparison", async () => {
  const snapshot = smallSnapshot(), first = snapshot.visits[0].turnId, last = snapshot.visits[3].turnId;
  const arrival = snapshot.flights.find(flight => flight.visitId === first && flight.direction === "arrival")!;
  const departure = snapshot.flights.find(flight => flight.visitId === last && flight.direction === "departure")!;
  arrival.scheduled = new Date(Date.parse(snapshot.plan_window.start) - minute).toISOString();
  departure.scheduled = new Date(Date.parse(snapshot.plan_window.end) + minute).toISOString();
  for (const plan of Object.values(snapshot.variants)) for (const stay of plan.stays) {
    if (stay.arrivalFlightId === arrival.id) stay.start = arrival.scheduled;
    if (stay.departureFlightId === departure.id) stay.end = departure.scheduled;
  }
  const result = buildPlanComparison(await smallDataset("baseline", true, snapshot))!;
  assert.equal(result.reference.coverage.contextFlightLegs, 2);
  assert.equal(result.alternative.coverage.contextFlightLegs, 2);
  assert.equal(result.reference.coverage.flightLegs, 8);
  assert.equal(result.alternative.coverage.flightLegs, 8);
});

test("companion envelope is strict and both complete plans must pass the shared prepared adapter", async () => {
  for (const value of [
    null, {}, { ...evidence, schema_version: "2.0.0" }, { ...evidence, snapshot_fingerprint: "bad" },
    { ...evidence, accepted: true }, { ...evidence, snapshot: {} },
  ]) assert.throws(() => parsePlanComparison(value), /plan-comparison/);
  for (const mutate of [
    (value: PreparedScenario) => { value.variants["tow-options"].covered_flight_count -= 2; },
    (value: PreparedScenario) => { value.variants["tow-options"].generated_movement_count = 1; },
    (value: PreparedScenario) => { value.variants.baseline.stays[0].rowId = "missing"; },
    (value: PreparedScenario) => { value.variants["tow-options"].stays[0].arrivalFlightId = "missing"; },
    (value: PreparedScenario) => { value.variants["tow-options"].stays.push(value.variants["tow-options"].stays[0]); },
  ]) {
    const changed = structuredClone(evidence.snapshot); mutate(changed);
    await assert.rejects(preparePlanComparison(changed));
  }
});

test("selected source identity, complete active records, snapshot and both requests stay bound", () => {
  for (const changed of [
    { ...source, airportId: "other" },
    { ...source, capabilities: { editStands: true, fixtureAnalyses: false } },
    { ...source, preparedPlan: undefined },
    { ...source, preparedPlan: { ...source.preparedPlan!, demandId: "other" } },
    { ...source, preparedPlan: { ...source.preparedPlan!, caseId: "constrained" } },
    { ...source, preparedPlan: { ...source.preparedPlan!, requestFingerprint: "0".repeat(64) } },
    { ...source, domain: [source.domain[0] + minute, source.domain[1]] as const },
  ]) assert.throws(() => validatePlanComparisonDataset(evidence, changed, source.overlays!.profiles));
  for (const field of ["estimate", "routeEnd", "registration", "standId"] as const) {
    const changed = structuredClone(source);
    if (field === "estimate") changed.flights[0].estimate += minute;
    else changed.flights[0][field] = "changed";
    assert.throws(() => validatePlanComparisonDataset(evidence, changed, source.overlays!.profiles), /active reference records/);
  }
  const stale = structuredClone(evidence); stale.snapshot_fingerprint = "0".repeat(64);
  assert.throws(() => validatePlanComparisonDataset(stale, source, source.overlays!.profiles), /provenance/);
  for (const variant of ["baseline", "tow-options"] as const) {
    const changed = structuredClone(evidence); changed.snapshot.variants[variant].request_fingerprint = "0".repeat(64);
    assert.throws(() => validatePlanComparisonDataset(changed, source, source.overlays!.profiles), /plan|provenance/);
  }
  const reordered = structuredClone(source);
  reordered.flights.reverse(); reordered.timeline.rows.reverse(); reordered.timeline.occupancies.reverse();
  assert.doesNotThrow(() => validatePlanComparisonDataset(evidence, reordered, source.overlays!.profiles));
});

test("validation uses the supplied companion profiles, not an earlier dataset envelope", () => {
  assert.throws(() => validatePlanComparisonDataset(evidence, source, {}), /decision-review/);
  const profiles = { ...source.overlays!.profiles };
  const changed = structuredClone(parsePlanComparison(source.overlays!.companions!["plan-comparison"]));
  changed.snapshot_fingerprint = "0".repeat(64);
  assert.throws(() => validatePlanComparisonDataset(changed, source, profiles), /provenance/);
  assert.throws(() => createOperationsDataset({ ...source, overlays: {
    ...source.overlays!, companions: { "plan-comparison": {} },
  } }), /plan-comparison/);
});

test("comparison is optional and has no separate overlay registration", async () => {
  const { companions: _companions, ...overlays } = source.overlays!;
  const without = createOperationsDataset({ ...source, overlays });
  assert.equal(buildPlanComparison(without), null);
  assert.deepEqual(availableOverlays(source), availableOverlays(without));
  assert.equal(availableOverlays(source).length, 6);
  for (const name of ["fixture", "gtaa"]) {
    assert.equal(buildPlanComparison(await loadSourceDataset({ source: name, plan: "baseline" })), null);
  }
});

test("comparison does not change board records, indexes, sidecars or accommodation preview selection", () => {
  const before = structuredClone(source);
  const summary = buildDecisionSummary(source, { accommodationOptionId: buildDecisionSummary(source).accommodation!.options[0].id });
  const first = buildPlanComparison(source);
  buildPlanComparison(source, "stressed");
  assert.deepEqual(source, before);
  assert.deepEqual(buildPlanComparison(source), first);
  assert.deepEqual(buildDecisionSummary(source, { accommodationOptionId: summary.preview!.optionId }), summary);
  assert.equal(source.flightsById.get(source.flights[0].id), source.flights[0]);
});
