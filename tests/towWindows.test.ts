import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import { createOperationsDataset } from "../src/operations/dataset.ts";
import {
  evaluateTowWindows, parseTowWindows, towWindowSegments, validateTowWindowsDataset, validateTowWindowsSnapshot,
  type PreparedTowWindows,
} from "../src/overlays/towWindows.ts";
import { mergeTowRanges } from "../src/overlays/tow-window-ranges.mjs";

const read = (suffix: string) => JSON.parse(readFileSync(new URL(`../src/data-sources/prepared/contoso/full-day${suffix}.json`, import.meta.url), "utf8"));
const snapshot = read(""), evidence = parseTowWindows(read(".tow-windows"));
const dataset = await loadSourceDataset({ source: "contoso", plan: "baseline" });
const assessed = () => evaluateTowWindows(evidence, dataset);
const policyWithWindow = evidence.visits.find(item => item.variants.baseline.destinations.length)!;
const policyWithBlocker = evidence.visits.find(item => item.variants.baseline.destinations.some(destination => destination.blockers.length))!;

test("tow evidence binds the exact source, airport, scenario, demand, horizon and both requests", async () => {
  assert.deepEqual(await validateTowWindowsSnapshot(evidence, snapshot), evidence);
  for (const change of [
    () => { const changed = structuredClone(snapshot); changed.airport.id = "gtaa"; return changed; },
    () => { const changed = structuredClone(snapshot); changed.case_id = "comfortable"; return changed; },
    () => { const changed = structuredClone(snapshot); changed.demand_id += ":stale"; return changed; },
    () => { const changed = structuredClone(snapshot); changed.rows[0].label += ":stale"; return changed; },
    () => { const changed = structuredClone(snapshot); changed.variants["tow-options"].stays[0].end = "2026-10-28T20:00:00Z"; return changed; },
  ]) await assert.rejects(validateTowWindowsSnapshot(evidence, change()), /do not match/);
  for (const variant of ["baseline", "tow-options"] as const) {
    const changed = structuredClone(evidence);
    changed.variants[variant].request_fingerprint = "0".repeat(64);
    await assert.rejects(validateTowWindowsSnapshot(changed, snapshot), /fingerprint/);
  }
  await assert.rejects(validateTowWindowsSnapshot(evidence, null), /do not match/);
});

const corruptions: [string, (value: PreparedTowWindows) => void][] = [
  ["duplicate visits", value => { value.visits.push(value.visits[0]); }],
  ["missing visits", value => { value.visits.pop(); }],
  ["unknown flight", value => { value.visits[0].arrival_flight_id = "unknown"; }],
  ["incorrect direction", value => { value.visits[0].arrival_flight_id = value.visits[0].departure_flight_id; }],
  ["wrong visit source", value => { value.visits.find(item => item.visit_id === policyWithWindow.visit_id)!.variants.baseline.source_stay_id = "unknown"; }],
  ["unknown destination", value => {
    value.visits.find(item => item.visit_id === policyWithWindow.visit_id)!.variants.baseline.destinations[0].stand_id = "unknown";
  }],
  ["duplicate destinations", value => {
    const plan = value.visits.find(item => item.visit_id === policyWithWindow.visit_id)!.variants.baseline;
    plan.destinations.push(plan.destinations[0]);
  }],
  ["missing stand assessment", value => {
    value.visits.find(item => item.visit_id === policyWithWindow.visit_id)!.variants.baseline.destinations.pop();
  }],
  ["impossible earliest start", value => {
    value.visits.find(item => item.visit_id === policyWithWindow.visit_id)!.variants.baseline.destinations[0].earliest_start--;
  }],
  ["impossible latest start", value => {
    value.visits.find(item => item.visit_id === policyWithWindow.visit_id)!.variants.baseline.destinations[0].latest_start++;
  }],
  ["unsafe time", value => {
    value.visits.find(item => item.visit_id === policyWithWindow.visit_id)!.variants.baseline.destinations[0].latest_start = Number.MAX_SAFE_INTEGER + 1;
  }],
  ["incorrect blocker release", value => {
    const destination = value.visits.find(item => item.visit_id === policyWithBlocker.visit_id)!.variants.baseline.destinations.find(item => item.blockers.length)!;
    destination.blockers[0].release++;
  }],
  ["unknown blocking assignment", value => {
    const destination = value.visits.find(item => item.visit_id === policyWithBlocker.visit_id)!.variants.baseline.destinations.find(item => item.blockers.length)!;
    destination.blockers[0].assignment_id = "unknown";
  }],
  ["calendar overflow", value => { value.plan_window.start = "2026-02-30T00:00:00Z"; }],
  ["zero travel", value => { value.default_tow_minutes = 0; }],
  ["fractional millisecond handling", value => { value.visits[0].arrival_handling_minutes = 0.0000001; }],
];
for (const [name, corrupt] of corruptions) {
  test(`tow-window validation rejects ${name}`, () => {
    const changed = structuredClone(evidence);
    corrupt(changed);
    assert.throws(() => validateTowWindowsDataset(changed, dataset));
  });
}

test("tow-window validation checks the selected read-only dataset without requiring another feature", async () => {
  for (const variant of ["baseline", "tow-options"] as const) {
    const source = await loadSourceDataset({ source: "contoso", plan: variant });
    const onlyTow = { ...source, overlays: {
      airportId: source.airportId, datasetId: source.id, profiles: { "tow-windows": evidence },
    } };
    assert.doesNotThrow(() => createOperationsDataset(onlyTow));
    for (const changed of [
      { ...onlyTow, preparedPlan: undefined },
      { ...onlyTow, airportId: "gtaa" },
      { ...onlyTow, preparedPlan: { ...source.preparedPlan!, caseId: "wrong" } },
      { ...onlyTow, preparedPlan: { ...source.preparedPlan!, requestFingerprint: "0".repeat(64) } },
      { ...onlyTow, domain: [source.domain[0] + 1, source.domain[1]] as const },
      { ...onlyTow, capabilities: { editStands: true, fixtureAnalyses: false } },
    ]) assert.throws(() => validateTowWindowsDataset(evidence, changed), /read-only dataset/);
  }
});

test("registered sidecars cannot mix different airport or demand provenance", async () => {
  const { default: capacity } = await import("../src/data-sources/prepared/contoso/full-day.capacity.json", { with: { type: "json" } });
  for (const key of ["airport_fingerprint", "demand_fingerprint"] as const) {
    const original = capacity[key];
    try {
      capacity[key] = "0".repeat(64);
      await assert.rejects(loadSourceDataset({ source: "contoso", plan: "baseline" }), /different airport or demand provenance/);
    } finally {
      capacity[key] = original;
    }
  }
});

test("tow assessments distinguish available, unassigned, insufficient-time and blocked visits without adding assignments", () => {
  const before = structuredClone([evidence, dataset.timeline.occupancies, dataset.noStandStays, dataset.flights]);
  const result = assessed();
  assert.equal(result.length, 160);
  assert.equal(result.filter(item => item.status === "available").length, 22);
  assert.equal(result.filter(item => item.status === "unassigned").length, 11);
  assert.ok(result.some(item => item.status === "insufficient-time"));
  assert.ok(result.some(item => item.status === "no-destination"));
  for (const item of result.filter(item => item.status === "unassigned")) {
    assert.equal(item.stayId, null);
    assert.deepEqual(item.destinations, []);
  }
  assert.deepEqual([evidence, dataset.timeline.occupancies, dataset.noStandStays, dataset.flights], before);
});

test("existing movement chains and incomplete boundaries are not reinterpreted as new tow windows", () => {
  const selected = assessed().find(item => item.status === "available")!;
  const original = dataset.timeline.occupancies.find(stay => stay.id === selected.stayId)!;
  const first = { ...original, end: original.start + 60_000 };
  const last = { ...original, id: `${original.id}:last`, start: first.end + 12 * 60_000 };
  const source = {
    ...dataset,
    flights: dataset.flights.filter(flight => flight.visitId === selected.id).map(flight => ({
      ...flight, occupancyId: flight.direction === "arrival" ? first.id : last.id,
    })),
    timeline: { ...dataset.timeline,
      visits: dataset.timeline.visits.filter(visit => visit.id === selected.id), occupancies: [first, last],
      endpoints: new Map([
        [first.id, { start: { kind: "flight", flight: "A", origin: "AAA" }, end: { kind: "tow" } }],
        [last.id, { start: { kind: "tow" }, end: { kind: "flight", flight: "B", destination: "BBB" } }],
      ] as const),
    },
  };
  const changed = structuredClone(evidence);
  const policy = changed.visits.find(item => item.visit_id === selected.id)!;
  policy.variants.baseline = { source_stay_id: null, destinations: [], exclusions: [] };
  changed.visits = [policy];
  assert.equal(evaluateTowWindows(changed, source)[0].status, "existing-chain");
  source.timeline.occupancies = [first];
  assert.equal(evaluateTowWindows(changed, source)[0].status, "incomplete");
});

test("tow display preserves inclusive points, merges adjacent instants and clips to a half-open horizon", () => {
  const item = assessed().find(item => item.status === "available")!;
  const destination = item.destinations[0];
  const testItem = { ...item, destinations: [{ ...destination, earliest_start: 10, latest_start: 20 }] };
  assert.deepEqual(mergeTowRanges([[12, 12], [13, 20], [5, 9], [0, 5]]), [[0, 9], [12, 20]]);
  assert.deepEqual(towWindowSegments([testItem], [20, 21]).map(item => [item.earliest, item.latest]), [[20, 20]]);
  assert.equal(towWindowSegments([testItem], [0, 10]).length, 0);
  assert.deepEqual(towWindowSegments([testItem], [12, 18]).map(item => [item.earliest, item.latest]), [[12, 17]]);
  assert.equal(towWindowSegments([{ ...testItem, status: "unassigned", stayId: null }], [0, 30]).length, 0);
  assert.throws(() => towWindowSegments([testItem], [10, 10]), /horizon/);
});
