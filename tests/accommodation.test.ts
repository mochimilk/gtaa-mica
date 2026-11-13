import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import { createOperationsDataset } from "../src/operations/dataset.ts";
import { parseBufferProfile, parseGateWaitProfile } from "../src/overlays/profiles.ts";
import { parseCapacitySnapshot } from "../src/overlays/capacity.ts";
import { standHandovers } from "../src/overlays/handovers.ts";
import {
  accommodationImpact, accommodationOptionLabel, parseAccommodation, previewAccommodation,
  validateAccommodationCapacity, validateAccommodationDataset, validateAccommodationSnapshot, type PreparedAccommodation,
} from "../src/overlays/accommodation.ts";
import { loadAirport } from "../scripts/airport-model.mjs";
import { generateScenario, loadScenarioProfile } from "../scripts/scenario-generator.mjs";
import { prepareAccommodation } from "../scripts/accommodation.mjs";

const read = (suffix: string) => JSON.parse(readFileSync(new URL(`../src/data-sources/prepared/contoso/full-day${suffix}.json`, import.meta.url), "utf8"));
const snapshot = read(""), evidence = parseAccommodation(read(".accommodation"));
const capacity = parseCapacitySnapshot(read(".capacity"));
const dataset = await loadSourceDataset({ source: "contoso", plan: "baseline" });
const buffer = parseBufferProfile(dataset.overlays!.profiles.buffers);
const waiting = parseGateWaitProfile(dataset.overlays!.profiles["gate-wait"]);
const option = evidence.variants.baseline.options[0];

test("accommodation binds the complete source and both plan requests", async () => {
  assert.deepEqual(await validateAccommodationSnapshot(evidence, snapshot), evidence);
  for (const change of [
    () => { const changed = structuredClone(snapshot); changed.airport.id = "gtaa"; return changed; },
    () => { const changed = structuredClone(snapshot); changed.case_id = "comfortable"; return changed; },
    () => { const changed = structuredClone(snapshot); changed.demand_id += ":stale"; return changed; },
    () => { const changed = structuredClone(snapshot); changed.rows[0].label += ":stale"; return changed; },
    () => { const changed = structuredClone(snapshot); changed.variants["tow-options"].stays[0].end = "2026-10-24T20:00:00Z"; return changed; },
  ]) await assert.rejects(validateAccommodationSnapshot(evidence, change()), /does not match/);
  for (const variant of ["baseline", "tow-options"] as const) {
    const changed = structuredClone(evidence);
    changed.variants[variant].request_fingerprint = "0".repeat(64);
    await assert.rejects(validateAccommodationSnapshot(changed, snapshot), /dataset\/plan/);
  }
});

test("accommodation verifies common provenance and source probe fields without depending on JSON member ordering", () => {
  assert.doesNotThrow(() => validateAccommodationCapacity(evidence, capacity));
  const reordered = parseAccommodation({
    ...evidence, request: { ...evidence.request, probe: Object.fromEntries(Object.entries(evidence.request.probe).reverse()) },
  });
  assert.doesNotThrow(() => validateAccommodationCapacity(reordered, capacity));
  for (const key of ["airport_fingerprint", "demand_fingerprint", "snapshot_fingerprint"] as const) {
    const changed = structuredClone(evidence);
    changed[key] = "0".repeat(64);
    assert.throws(() => validateAccommodationCapacity(changed, capacity), /provenance/);
  }
  const foreign = structuredClone(evidence);
  foreign.request.probe.label += ":foreign";
  assert.throws(() => validateAccommodationCapacity(foreign, capacity), /source-owned/);
  const horizon = structuredClone(evidence);
  horizon.plan_window.end = horizon.plan_window.start;
  assert.throws(() => validateAccommodationCapacity(horizon, capacity), /provenance/);
  const request = structuredClone(evidence);
  request.variants["tow-options"].request_fingerprint = "0".repeat(64);
  assert.throws(() => validateAccommodationCapacity(request, capacity), /provenance/);
});

const corruptions: [string, (value: PreparedAccommodation) => void][] = [
  ["legacy contract", value => { Object.assign(value, { schema_version: "1.1.0" }); }],
  ["calendar overflow", value => { value.request.start = "2026-02-30T00:00:00Z"; }],
  ["request timing", value => { value.request.end = value.request.start; }],
  ["late synthetic receipt", value => { value.received_at = value.request.start; }],
  ["duplicate cases", value => { value.profile.cases[1] = value.profile.cases[0]; }],
  ["wrong aircraft", value => { value.request.visit.aircraftType = "unknown"; }],
  ["request flight link", value => { value.request.flights[0].visitId = "unknown"; }],
  ["request identity collision", value => { value.request.visit.registration = snapshot.visits[0].registration; }],
  ["wrong counts", value => { value.variants.baseline.total_options_found++; }],
  ["wrong status", value => { value.variants.baseline.status = "no-acceptable-option-found"; }],
  ["duplicate options", value => { value.variants.baseline.options[1] = value.variants.baseline.options[0]; }],
  ["duplicate effects", value => { value.variants.baseline.options[1] = { ...value.variants.baseline.options[0], id: "different-id" }; }],
  ["missing stand evidence", value => { value.variants.baseline.excluded_stands.pop(); }],
  ["unknown blocker", value => { value.variants.baseline.blocked_stands[0].blocking_stay_ids = ["unknown"]; }],
  ["non-overlapping blocker", value => {
    value.variants.baseline.blocked_stands[0].blocking_stay_ids = [
      dataset.timeline.occupancies.find(stay => stay.end <= Date.parse(value.request.start))!.id,
    ];
  }],
  ["unknown destination", value => { value.variants.baseline.options[0].moves[0].to_stand_id = "unknown"; }],
  ["incorrect source stand", value => { value.variants.baseline.options[0].moves[0].from_stand_id = "unknown"; }],
  ["repair disguised as direct", value => { value.variants.baseline.options[0].kind = "direct"; }],
  ["unchanged reassignment", value => {
    const move = value.variants.baseline.options[0].moves[0];
    move.to_stand_id = move.from_stand_id;
  }],
  ["overlapping preview", value => {
    value.variants.baseline.options[0].moves[0].to_stand_id = value.variants.baseline.options[0].target_stand_id;
  }],
];
for (const [name, corrupt] of corruptions) {
  test(`accommodation rejects ${name}`, () => {
    const changed = structuredClone(evidence);
    corrupt(changed);
    assert.throws(() => validateAccommodationDataset(changed, dataset));
  });
}

test("only exact read-only datasets can register accommodation, without requiring unrelated profiles", async () => {
  for (const variant of ["baseline", "tow-options"] as const) {
    const source = await loadSourceDataset({ source: "contoso", plan: variant });
    const single = { ...source, overlays: {
      airportId: source.airportId, datasetId: source.id, profiles: { accommodation: evidence },
    } };
    assert.doesNotThrow(() => createOperationsDataset(single));
    for (const changed of [
      { ...single, preparedPlan: undefined },
      { ...single, airportId: "gtaa" },
      { ...single, preparedPlan: { ...source.preparedPlan!, caseId: "other" } },
      { ...single, preparedPlan: { ...source.preparedPlan!, requestFingerprint: "0".repeat(64) } },
      { ...single, domain: [source.domain[0] + 1, source.domain[1]] as const },
      { ...single, capabilities: { editStands: true, fixtureAnalyses: false } },
    ]) assert.throws(() => validateAccommodationDataset(evidence, changed), /read-only dataset/);
  }
});

test("context stays and existing movement endpoints are protected", () => {
  for (const change of ["context", "tow", "time"] as const) {
    const source = structuredClone(dataset), move = option.moves[0];
    const stay = source.timeline.occupancies.find(stay => stay.id === move.stay_id)!;
    if (change === "context") stay.start = source.domain[0] - 1;
    if (change === "tow") source.timeline.endpoints.get(stay.id)!.start = { kind: "tow" };
    if (change === "time") source.flights.find(flight => flight.occupancyId === stay.id && flight.direction === "arrival")!.estimate++;
    assert.throws(() => validateAccommodationDataset(evidence, source), /protected|occupancy/);
  }
  const overlapping = structuredClone(dataset);
  overlapping.timeline.occupancies.push({ ...overlapping.timeline.occupancies[0], id: "overlap" });
  assert.throws(() => validateAccommodationDataset(evidence, overlapping), /reference occupancy/);
});

test("every preview preserves existing demand, times, endpoints and reference evidence without accumulating repairs", async () => {
  for (const variant of ["baseline", "tow-options"] as const) {
    const source = await loadSourceDataset({ source: "contoso", plan: variant }), before = structuredClone(source);
    for (const candidate of evidence.variants[variant].options) {
      const preview = previewAccommodation(source, evidence, candidate.id);
      assert.equal(preview.kind, "accommodation-preview");
      assert.equal("preparedPlan" in preview, false);
      assert.equal("overlays" in preview, false);
      assert.equal(preview.flights.length, source.flights.length + 2);
      assert.equal(preview.timeline.occupancies.length, source.timeline.occupancies.length + 1);
      for (const stay of source.timeline.occupancies) {
        const changed = preview.timeline.occupancies.find(item => item.id === stay.id)!;
        const move = candidate.moves.find(item => item.stay_id === stay.id);
        assert.deepEqual({ ...changed, rowId: stay.rowId }, stay);
        assert.equal(changed.rowId, move?.to_stand_id ?? stay.rowId);
        assert.deepEqual(preview.timeline.endpoints.get(stay.id), source.timeline.endpoints.get(stay.id));
      }
      for (const flight of source.flights) {
        const changed = preview.flights.find(item => item.id === flight.id)!;
        const { standId: previousStand, ...previousDetails } = flight;
        const { standId: nextStand, ...nextDetails } = changed;
        assert.deepEqual(nextDetails, previousDetails);
        assert.equal(nextStand, candidate.moves.find(move => move.stay_id === flight.occupancyId)?.to_stand_id ?? previousStand);
        if (!flight.standId) assert.deepEqual(changed, flight, "existing unassigned traffic must remain unassigned");
      }
      assert.match(accommodationOptionLabel(source, candidate), /Incoming|Direct/);
    }
    assert.deepEqual(source, before);
  }
  assert.throws(() => previewAccommodation(dataset, evidence, "unknown"), /Unknown/);
});

test("preview consequences use source profiles and a like-for-like existing-arrival population", () => {
  const before = structuredClone([dataset, evidence]);
  for (const assumption of waiting.assumptions) {
    const impact = accommodationImpact(dataset, evidence, option.id, buffer, assumption);
    const reference = new Map(impact.beforeWaiting!.contributions.map(item => [item.arrival.id, item.minutes]));
    const common = impact.afterWaiting!.contributions.filter(item => reference.has(item.arrival.id));
    assert.equal(impact.commonArrivals, common.length);
    assert.equal(impact.beforeCommonMinutes, common.length ? common.reduce((sum, item) => sum + reference.get(item.arrival.id)!, 0) : null);
    assert.equal(impact.afterCommonMinutes, common.length ? common.reduce((sum, item) => sum + item.minutes, 0) : null);
    assert.ok(!reference.has(evidence.request.flights[0].id));
  }
  const missing = accommodationImpact(dataset, evidence, option.id, null, null);
  assert.equal(missing.beforeBuffers.tight, null);
  assert.equal(missing.afterWaiting, null);
  assert.equal(missing.beforeCommonMinutes, null);
  assert.equal(missing.incomingMinutes, null);
  const detached = previewAccommodation(dataset, evidence, option.id);
  detached.flights[0].estimate++;
  detached.timeline.endpoints.get(evidence.request.stay_id)!.start = { kind: "none" };
  assert.deepEqual([dataset, evidence], before);
});

test("tight buffers honor the exact threshold and waiting responds to source assumptions", () => {
  const gaps = standHandovers(dataset.timeline.occupancies, dataset.domain).handovers;
  const threshold = gaps.find(item => item.minutes > 0)!.minutes;
  const impact = accommodationImpact(dataset, evidence, option.id, { ...buffer, threshold_minutes: threshold }, waiting.assumptions[0]);
  assert.equal(impact.beforeBuffers.tight, gaps.filter(item => item.minutes < threshold).length);
  assert.notEqual(impact.beforeBuffers.tight, gaps.filter(item => item.minutes <= threshold).length);
  for (const assumption of waiting.assumptions) {
    const changed = accommodationImpact(dataset, evidence, option.id, buffer, assumption);
    for (const contribution of changed.afterWaiting!.contributions) {
      assert.equal(contribution.minutes, assumption.release_delay_probability *
        Math.max(0, assumption.expected_release_delay_minutes_given_delay - contribution.handover.minutes));
    }
    const incoming = changed.afterWaiting!.contributions.find(item => item.arrival.id === evidence.request.flights[0].id);
    assert.equal(changed.incomingMinutes, incoming?.minutes ?? null);
    assert.equal(changed.afterWaiting!.assessed + changed.afterWaiting!.unassessed, dataset.arrivals.filter(
      flight => flight.occupancyId && flight.estimate >= dataset.domain[0] && flight.estimate < dataset.domain[1]).length + 1);
  }
});

test("direct placements and bounded-search failure are real source-valid states, not success-shaped fallbacks", async () => {
  const airport = loadAirport(fileURLToPath(new URL("../data/airports/contoso/airport.json", import.meta.url)));
  const profile = loadScenarioProfile(fileURLToPath(new URL("../data/airports/contoso/demand/full-day-profile.json", import.meta.url)));
  const raw = generateScenario(profile, airport, "full-day").raw_demand;
  const make = async (probeId: string, offset: number, duration: number) => {
    const input = {
      ...evidence.profile, cases: evidence.profile.cases.map(item => item.case_id === "full-day"
        ? { ...item, probe_id: probeId, start_offset_minutes: offset, duration_minutes: duration } : item),
    };
    const probe = capacity.profile.probes.find(item => item.id === probeId)!;
    return validateAccommodationSnapshot(prepareAccommodation(snapshot, raw, airport, input, probe, profile.route_generation), snapshot);
  };
  const direct = await make("aal-domestic", 60, 75);
  assert.equal(direct.variants.baseline.search, "direct-placement");
  assert.ok(direct.variants.baseline.options.length);
  assert.equal(previewAccommodation(dataset, direct, direct.variants.baseline.options[0].id).option.moves.length, 0);
  const blocked = await make("baw-international", 900, 120);
  assert.equal(blocked.variants.baseline.status, "no-acceptable-option-found");
  assert.deepEqual(blocked.variants.baseline.options, []);
  assert.throws(() => previewAccommodation(dataset, blocked, "anything"), /Unknown/);
});
