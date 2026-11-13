import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Ajv from "ajv";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import { createOperationsDataset } from "../src/operations/dataset.ts";
import { buildDecisionSummary } from "../src/overlays/decisionSummary.ts";
import { parseDecisionReviewProfile, parseBufferProfile, parseGateWaitProfile } from "../src/overlays/profiles.ts";
import { parseCapacitySnapshot, queryCapacity } from "../src/overlays/capacity.ts";
import { evaluateTowWindows, parseTowWindows } from "../src/overlays/towWindows.ts";
import { accommodationImpact, parseAccommodation } from "../src/overlays/accommodation.ts";
import { gateWaiting, standHandovers } from "../src/overlays/handovers.ts";
import { loadAirport } from "../scripts/airport-model.mjs";
import { generateScenario, loadScenarioProfile } from "../scripts/scenario-generator.mjs";
import { prepareAccommodation } from "../scripts/accommodation.mjs";

const source = await loadSourceDataset({ source: "contoso", plan: "baseline" });
const profiles = source.overlays!.profiles;
const profile = parseDecisionReviewProfile(profiles["decision-review"]);
const buffers = parseBufferProfile(profiles.buffers), waiting = parseGateWaitProfile(profiles["gate-wait"]);
const accommodation = parseAccommodation(profiles.accommodation);
const withProfiles = (selected: Readonly<Record<string, unknown>>) => ({
  ...source, overlays: { airportId: source.airportId, datasetId: source.id, profiles: selected },
});
const onlySummary = withProfiles({ "decision-review": profile });

test("decision profile parser and JSON schema agree on the bounded registration contract", () => {
  const schema = JSON.parse(readFileSync(new URL("../data/schemas/decision-review-profile.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv().compile(schema);
  assert.equal(validate(profile), true);
  for (const invalid of [
    { ...profile, schema_version: "2.0.0" }, { ...profile, metric_version: "2.0.0" },
    { ...profile, metric_id: "overall-resilience-score" }, { ...profile, id: "" },
    { ...profile, id: "contoso:invalid id" }, { ...profile, approval: true }, { ...profile, $schema: 1 },
  ]) {
    assert.equal(validate(invalid), false);
    assert.throws(() => parseDecisionReviewProfile(invalid), /decision-review profile/);
  }
});

test("summary registration stays source-owned and requires an exact read-only prepared plan", async () => {
  for (const other of ["fixture", "gtaa"]) {
    const dataset = await loadSourceDataset({ source: other, plan: "baseline" });
    assert.throws(() => buildDecisionSummary(dataset), /unavailable/);
  }
  for (const dataset of [
    { ...onlySummary, preparedPlan: undefined },
    { ...onlySummary, capabilities: { editStands: true, fixtureAnalyses: false } },
    { ...onlySummary, id: "foreign-plan" },
    { ...onlySummary, preparedPlan: { ...source.preparedPlan!, requestFingerprint: "bad" } },
    { ...onlySummary, airportId: "gtaa" },
    { ...onlySummary, overlays: { ...onlySummary.overlays, datasetId: "stale" } },
    withProfiles({ "decision-review": { ...profile, id: "gtaa:decision-review" } }),
  ]) assert.throws(() => createOperationsDataset(dataset), /read-only|dataset|another airport|Prepared plan/);
  assert.doesNotThrow(() => createOperationsDataset(onlySummary));
});

test("reference coverage, buffers and modeled populations are measured rather than inferred from opportunity counts", () => {
  const summary = buildDecisionSummary(source);
  assert.equal(summary.preview, null);
  assert.equal(summary.reference.coverage.visits, 160);
  assert.equal(summary.reference.coverage.assignedVisits, 149);
  assert.equal(summary.reference.coverage.unassignedVisits, 11);
  assert.equal(summary.reference.coverage.flightLegs, 320);
  assert.equal(summary.reference.coverage.assignedFlightLegs, 298);
  assert.equal(summary.reference.coverage.unassignedFlightLegs, 22);
  assert.deepEqual(summary.reference.buffers, { handovers: 105, tight: 34, minimum: 0 });
  assert.equal(summary.reference.waiting!.assessed, 105);
  assert.equal(summary.reference.waiting!.unassessed, 44);
  assert.equal(summary.reference.waiting!.totalMinutes, 92);
  const stressed = buildDecisionSummary(source, { assumptionId: "stressed" });
  assert.equal(stressed.reference.waiting!.totalMinutes, 660.5);
  assert.deepEqual(stressed.reference.coverage, summary.reference.coverage);
  assert.deepEqual(stressed.reference.capacity, summary.reference.capacity);
  assert.deepEqual(stressed.reference.tow, summary.reference.tow);
});

test("capacity is shown per source-default probe at the full horizon, never as additive slots", () => {
  const evidence = parseCapacitySnapshot(profiles.capacity), summary = buildDecisionSummary(source);
  for (const probe of evidence.profile.probes) {
    const expected = queryCapacity(evidence, "baseline", probe.id, probe.default_duration_minutes, ...source.domain);
    const actual = summary.reference.capacity!.find(item => item.id === probe.id)!;
    assert.equal(actual.bands, expected.opportunities.length);
    assert.equal(actual.stands, new Set(expected.opportunities.map(item => item.rowId)).size);
    assert.equal(actual.durationMinutes, probe.default_duration_minutes);
    assert.equal(actual.separationMinutes, probe.separation_minutes);
  }
  assert.equal("totalSlots" in summary.reference, false);
  assert.equal(summary.reference.capacity!.find(item => item.id === "aal-domestic")!.bands, 55);
});

test("tow populations retain all source assessments without treating destination choices as movements", () => {
  const expected = evaluateTowWindows(parseTowWindows(profiles["tow-windows"]), source);
  const actual = buildDecisionSummary(source).reference.tow!;
  assert.equal(actual.visitsWithWindows, 22);
  assert.equal(actual.totalVisits, 160);
  assert.equal(actual.statuses.reduce((sum, item) => sum + item.count, 0), 160);
  assert.equal(actual.destinationChoices, expected.reduce((sum, item) => sum + item.destinations.length, 0));
  assert.equal(actual.statuses.find(item => item.id === "unassigned")!.count, 11);
  assert.equal("scheduledMovements" in actual, false);
});

test("missing analyses remain unavailable rather than borrowing global assumptions or reporting zero", () => {
  const summary = buildDecisionSummary(onlySummary);
  assert.equal(summary.reference.buffers, null);
  assert.equal(summary.reference.waiting, null);
  assert.equal(summary.reference.capacity, null);
  assert.equal(summary.reference.tow, null);
  assert.equal(summary.accommodation, null);
  assert.equal(summary.preview, null);
  assert.equal(summary.source.snapshotFingerprint, null);
  assert.deepEqual(summary.reference.coverage, buildDecisionSummary(source).reference.coverage);
  assert.throws(() => buildDecisionSummary(onlySummary, { assumptionId: "routine" }), /unavailable/);
  assert.throws(() => buildDecisionSummary(onlySummary, { accommodationOptionId: "unknown" }), /unavailable/);
  assert.throws(() => buildDecisionSummary(source, { assumptionId: "unknown" }), /Unknown/);
  assert.throws(() => buildDecisionSummary(source, { accommodationOptionId: "" }), /Unknown/);
});

test("individual source analyses can participate without requiring unrelated profiles", () => {
  for (const id of ["buffers", "gate-wait", "capacity", "tow-windows", "accommodation"]) {
    const dataset = withProfiles({ "decision-review": profile, [id]: profiles[id] });
    const summary = buildDecisionSummary(createOperationsDataset(dataset));
    assert.equal(summary.reference.buffers !== null, id === "buffers");
    assert.equal(summary.reference.waiting !== null, id === "gate-wait");
    assert.equal(summary.reference.capacity !== null, id === "capacity");
    assert.equal(summary.reference.tow !== null, id === "tow-windows");
    assert.equal(summary.accommodation !== null, id === "accommodation");
    if (id === "accommodation") {
      const selected = buildDecisionSummary(dataset, { accommodationOptionId: accommodation.variants.baseline.options[0].id });
      assert.equal(selected.preview!.buffers, null);
      assert.equal(selected.preview!.waiting, null);
      assert.equal(selected.preview!.incomingMinutes, null);
      assert.equal(selected.preview!.beforeCommonMinutes, null);
    }
  }
});

test("a source-specific summary registration is not hardcoded to an airport name", () => {
  const dataset = { ...onlySummary, airportId: "another-airport", overlays: {
    airportId: "another-airport", datasetId: source.id,
    profiles: { "decision-review": { ...profile, id: "another-airport:decision-review" } },
  } };
  assert.equal(buildDecisionSummary(createOperationsDataset(dataset)).source.airportId, "another-airport");
});

test("direct fits, a real bounded-search failure and zero capacity windows remain distinct from unavailable evidence", () => {
  const airport = loadAirport(fileURLToPath(new URL("../data/airports/contoso/airport.json", import.meta.url)));
  const scenarioProfile = loadScenarioProfile(fileURLToPath(new URL("../data/airports/contoso/demand/full-day-profile.json", import.meta.url)));
  const snapshot = JSON.parse(readFileSync(new URL("../src/data-sources/prepared/contoso/full-day.json", import.meta.url), "utf8"));
  const raw = generateScenario(scenarioProfile, airport, "full-day").raw_demand;
  const capacity = parseCapacitySnapshot(profiles.capacity);
  const make = (probeId: string, offset: number, duration: number) => {
    const input = {
      ...accommodation.profile, cases: accommodation.profile.cases.map(item => item.case_id === "full-day"
        ? { ...item, probe_id: probeId, start_offset_minutes: offset, duration_minutes: duration } : item),
    };
    const probe = capacity.profile.probes.find(item => item.id === probeId)!;
    return prepareAccommodation(snapshot, raw, airport, input, probe, scenarioProfile.route_generation);
  };
  const direct = parseAccommodation(make("aal-domestic", 60, 75));
  const directSummary = buildDecisionSummary(withProfiles({ ...profiles, accommodation: direct }), {
    accommodationOptionId: direct.variants.baseline.options[0].id,
  });
  assert.equal(directSummary.preview!.changedVisits, 0);
  assert.equal(directSummary.preview!.changes.length, 1);
  const blocked = parseAccommodation(make("baw-international", 900, 120));
  const blockedSummary = buildDecisionSummary(withProfiles({ ...profiles, accommodation: blocked }));
  assert.equal(blockedSummary.accommodation!.status, "no-acceptable-option-found");
  assert.equal(blockedSummary.accommodation!.count, 0);
  assert.equal(blockedSummary.preview, null);
  const zero = structuredClone(capacity);
  zero.profile.probes.forEach(probe => { probe.default_duration_minutes = 1440; });
  const noCapacity = buildDecisionSummary(withProfiles({ "decision-review": profile, capacity: zero }));
  assert.ok(noCapacity.reference.capacity!.every(probe => probe.bands === 0 && probe.stands === 0));
});

for (const id of ["buffers", "gate-wait", "capacity", "tow-windows", "accommodation", "decision-review"]) {
  test(`present but invalid ${id} is an error, not an unavailable-analysis fallback`, () => {
    assert.throws(() => buildDecisionSummary(withProfiles({ ...profiles, [id]: undefined })));
  });
}

for (const field of ["snapshot_fingerprint", "airport_fingerprint", "demand_fingerprint"] as const) {
  test(`decision evidence must share ${field}`, () => {
    const changed = structuredClone(parseTowWindows(profiles["tow-windows"]));
    changed[field] = "0".repeat(64);
    assert.throws(() => buildDecisionSummary(withProfiles({ ...profiles, "tow-windows": changed })), /different source provenance/);
  });
}

test("other-variant identity and accommodation probe mismatches cannot hide in a summary", () => {
  const changed = structuredClone(parseTowWindows(profiles["tow-windows"]));
  changed.variants["tow-options"].request_fingerprint = "0".repeat(64);
  assert.throws(() => buildDecisionSummary(withProfiles({ ...profiles, "tow-windows": changed })), /different source provenance/);
  const request = structuredClone(accommodation);
  request.request.probe.label += ":foreign";
  assert.throws(() => buildDecisionSummary(withProfiles({ ...profiles, accommodation: request })), /source-owned/);
});

test("all alternatives on both plans produce independent summaries without changing the reference or reusing its evidence", async () => {
  for (const variant of ["baseline", "tow-options"] as const) {
    const dataset = await loadSourceDataset({ source: "contoso", plan: variant }), before = structuredClone(dataset);
    const reference = buildDecisionSummary(dataset);
    for (const option of accommodation.variants[variant].options) {
      const summary = buildDecisionSummary(dataset, { accommodationOptionId: option.id }), preview = summary.preview!;
      assert.deepEqual(summary.reference, reference.reference);
      assert.equal(preview.retainedVisits, 149);
      assert.equal(preview.lostVisits, 0);
      assert.equal(preview.changedVisits, 1);
      assert.equal(preview.newlyAssignedExistingVisits, 0);
      assert.equal(preview.addedVisits, 1);
      assert.equal(preview.unresolvedOriginalVisits, 11);
      assert.equal(preview.coverage.assignedVisits, 150);
      assert.equal(preview.coverage.flightLegs, 322);
      assert.equal(preview.coverage.assignedFlightLegs, 300);
      assert.deepEqual(preview.retimedFlightIds, []);
      assert.equal(preview.changes.filter(item => item.kind === "new-service").length, 1);
      assert.equal("capacity" in preview, false);
      assert.equal("tow" in preview, false);
      assert.equal("preparedPlan" in preview, false);
      assert.equal("overlays" in preview, false);
      for (const change of preview.changes) for (const flight of change.flights) {
        const original = dataset.flightsById.get(flight.id);
        if (original) assert.equal(flight.estimate, original.estimate);
        else assert.equal(flight.estimate, Date.parse(accommodation.request.flights.find(item => item.id === flight.id)!.scheduled));
      }
    }
    assert.deepEqual(dataset, before);
  }
});

test("consequence measures keep common existing arrivals separate from the incoming arrival", () => {
  const option = accommodation.variants.baseline.options[0];
  for (const assumption of waiting.assumptions) {
    const summary = buildDecisionSummary(source, { assumptionId: assumption.id, accommodationOptionId: option.id });
    const impact = accommodationImpact(source, accommodation, option.id, buffers, assumption);
    assert.equal(summary.preview!.commonArrivals, impact.commonArrivals);
    assert.equal(summary.preview!.beforeCommonMinutes, impact.beforeCommonMinutes);
    assert.equal(summary.preview!.afterCommonMinutes, impact.afterCommonMinutes);
    assert.equal(summary.preview!.incomingMinutes, impact.incomingMinutes);
    assert.equal(summary.preview!.waiting!.assessed, 106);
    assert.equal(summary.preview!.waiting!.unassessed, 44);
    assert.equal(summary.reference.waiting!.totalMinutes,
      gateWaiting({ domain: source.domain, timeline: source.timeline, arrivals: source.arrivals }, assumption).totalMinutes);
  }
});

test("threshold equality remains non-tight and empty assessment populations remain unassessed", () => {
  const gaps = standHandovers(source.timeline.occupancies, source.domain).handovers;
  const threshold = gaps.find(item => item.minutes > 0 && item.minutes <= 120)!.minutes;
  const adjusted = withProfiles({ ...profiles, buffers: { ...buffers, threshold_minutes: threshold } });
  const measured = buildDecisionSummary(adjusted).reference.buffers!;
  assert.equal(measured.tight, gaps.filter(item => item.minutes < threshold).length);
  assert.notEqual(measured.tight, gaps.filter(item => item.minutes <= threshold).length);
  const empty = { ...withProfiles({ "decision-review": profile, buffers, "gate-wait": waiting }),
    domain: [source.domain[1] + 7 * 86400000, source.domain[1] + 8 * 86400000] as const };
  const result = buildDecisionSummary(empty);
  assert.equal(result.reference.buffers!.minimum, null);
  assert.equal(result.reference.waiting!.assessed, 0);
  assert.equal(result.reference.waiting!.totalMinutes, null);
});

test("overlapping or unknown reference occupancy is not summarized as a valid zero-risk plan", () => {
  const overlapping = structuredClone(onlySummary), unknown = structuredClone(onlySummary);
  overlapping.timeline.occupancies.push({ ...overlapping.timeline.occupancies[0], id: "overlap" });
  assert.throws(() => buildDecisionSummary(overlapping), /overlapping reference/);
  unknown.timeline.occupancies[0].visitId = "unknown";
  assert.throws(() => buildDecisionSummary(unknown), /unknown visits/);
});
