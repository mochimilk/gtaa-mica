import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createOperationsDataset } from "../src/operations/dataset.ts";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import {
  evaluateCapacityQuery, fingerprintJson, parseCapacitySnapshot, queryCapacity, validateCapacityDataset, validateCapacitySnapshot,
  type PreparedCapacity,
} from "../src/overlays/capacity.ts";

const read = (suffix: string) => JSON.parse(readFileSync(new URL(`../src/data-sources/prepared/contoso/full-day${suffix}.json`, import.meta.url), "utf8"));
const source = read("");
const capacity = parseCapacitySnapshot(read(".capacity"));
const horizon = [Date.parse(capacity.plan_window.start), Date.parse(capacity.plan_window.end)] as const;
const probeId = capacity.profile.default_probe_id;
const query = (minutes = 75) => queryCapacity(capacity, "baseline", probeId, minutes, ...horizon);

test("fresh capacity evidence is bound to the exact source, airport, scenario, demand and both requests", async () => {
  assert.deepEqual(await validateCapacitySnapshot(capacity, source), capacity);
  assert.equal(await fingerprintJson(source), capacity.snapshot_fingerprint);
  for (const change of [
    () => { const changed = structuredClone(source); changed.airport.id = "gtaa"; return changed; },
    () => { const changed = structuredClone(source); changed.case_id = "comfortable"; return changed; },
    () => { const changed = structuredClone(source); changed.demand_id += ":stale"; return changed; },
    () => { const changed = structuredClone(source); changed.rows[0].label += ":changed"; return changed; },
    () => { const changed = structuredClone(source); changed.variants.baseline.stays[0].end = "2026-10-28T20:00:00Z"; return changed; },
  ]) await assert.rejects(validateCapacitySnapshot(capacity, change()), /does not match/);
  for (const variant of ["baseline", "tow-options"] as const) {
    const changed = structuredClone(capacity);
    changed.variants[variant].request_fingerprint = "0".repeat(64);
    await assert.rejects(validateCapacitySnapshot(changed, source), /fingerprint/);
  }
});

test("capacity validation rejects incomplete stand coverage and unknown assignment references", async () => {
  const incomplete = structuredClone(capacity);
  incomplete.variants.baseline.probes[0].rows.pop();
  await assert.rejects(validateCapacitySnapshot(incomplete, source), /Incomplete/);
  const unknown = structuredClone(capacity);
  unknown.variants.baseline.probes[0].rows.find(row => row.blocks.length)!.blocks[0].assignment_ids = ["unknown"];
  await assert.rejects(validateCapacitySnapshot(unknown, source), /assignment reference/);
});

const malformed: [string, (value: PreparedCapacity) => void][] = [
  ["default", value => { value.profile.default_probe_id = "unknown"; }],
  ["duplicate probe", value => { value.profile.probes.push(value.profile.probes[0]); }],
  ["duplicate plan probe", value => { value.variants.baseline.probes[1] = value.variants.baseline.probes[0]; }],
  ["stand repeated as excluded", value => {
    const probe = value.variants.baseline.probes[0];
    probe.excluded_stands.push({ stand_id: probe.rows[0].stand_id, reasons: ["closed"] });
  }],
  ["wrong profile airport", value => { value.profile.id = "gtaa:capacity"; }],
  ["broken complement", value => { value.variants.baseline.probes[0].rows.find(row => row.windows.length)!.windows.pop(); }],
  ["bad boundary", value => { value.variants.baseline.probes[0].rows.find(row => row.windows.length)!.windows[0].before = 99999; }],
  ["calendar overflow", value => { value.plan_window.start = "2026-02-30T00:00:00Z"; }],
];
for (const [name, corrupt] of malformed) {
  test(`capacity parser rejects ${name}`, () => {
    const changed = structuredClone(capacity);
    corrupt(changed);
    assert.throws(() => parseCapacitySnapshot(changed));
  });
}

test("capacity tolerates JSON member reordering without confusing it with stale evidence", () => {
  const reordered = structuredClone(capacity);
  for (const variant of Object.values(reordered.variants)) {
    for (const probe of variant.probes) for (const row of probe.rows) {
      row.windows = row.windows.map(({ start, end, before, after }) => ({ after, before, end, start }));
    }
  }
  assert.doesNotThrow(() => parseCapacitySnapshot(reordered));
});

test("capacity is validated against the active read-only dataset and selected variant", async () => {
  for (const variant of ["baseline", "tow-options"] as const) {
    const dataset = await loadSourceDataset({ source: "contoso", plan: variant });
    assert.equal(dataset.preparedPlan?.variant, variant);
    assert.doesNotThrow(() => validateCapacityDataset(capacity, dataset));
    const plan = dataset.preparedPlan!;
    for (const changed of [
      { ...dataset, preparedPlan: undefined },
      { ...dataset, preparedPlan: { ...plan, caseId: "other-case" } },
      { ...dataset, preparedPlan: { ...plan, demandId: "other-demand" } },
      { ...dataset, preparedPlan: { ...plan, requestFingerprint: "0".repeat(64) } },
      { ...dataset, domain: [horizon[0] + 60_000, horizon[1]] as const },
    ]) assert.throws(() => createOperationsDataset(changed), /Capacity|Prepared plan identity/);
    assert.throws(() => createOperationsDataset({
      ...dataset, preparedPlan: { ...plan, variant: variant === "baseline" ? "tow-options" : "baseline" },
    }), /Prepared plan identity/);
    assert.throws(() => createOperationsDataset({ ...dataset, capabilities: { editStands: true, fixtureAnalyses: false } }), /read-only/);
  }
});

test("capacity queries return inclusive exact-duration starts, not free occupancy spans", () => {
  const row = capacity.variants.baseline.probes.find(item => item.id === probeId)!.rows.find(item => item.windows.length)!;
  const window = row.windows[0];
  const start = Date.parse(window.start), end = Date.parse(window.end), duration = (end - start) / 60_000;
  const exact = queryCapacity(capacity, "baseline", probeId, duration, start, end);
  const point = exact.opportunities.find(item => item.rowId === row.stand_id)!;
  assert.equal(point.earliest, start);
  assert.equal(point.latest, start);
  assert.equal(point.availableEnd, end);
  assert.equal(queryCapacity(capacity, "baseline", probeId, duration + 1, start, end).opportunities.length, 0);
  for (const opportunity of query().opportunities) {
    assert.equal(opportunity.latest, opportunity.availableEnd - 75 * 60_000);
    assert.equal(opportunity.earliest, opportunity.availableStart);
    assert.ok(opportunity.latest >= opportunity.earliest);
  }
});

test("capacity query validation is explicit for invalid durations and out-of-horizon UTC inputs", () => {
  for (const duration of [0, -1, 1.1, 1441, NaN]) assert.throws(() => query(duration), /Invalid/);
  assert.throws(() => queryCapacity(capacity, "baseline", "unknown", 75, ...horizon), /Unknown/);
  assert.throws(() => queryCapacity(capacity, "baseline", probeId, 75, horizon[0] - 1, horizon[1]), /Invalid/);
  const start = capacity.plan_window.start.slice(0, -1), end = capacity.plan_window.end.slice(0, -1);
  for (const input of [
    ["", start, end], ["0", start, end], ["75", end, start], ["75", "", end],
    ["75", "2026-02-30T12:00", end], ["75", "2026-10-24T00:00", end],
  ]) {
    const result = evaluateCapacityQuery(capacity, probeId, input[0], input[1], input[2]);
    assert.ok(result.error);
    assert.equal(result.variants, null);
  }
  assert.equal(evaluateCapacityQuery(capacity, probeId, "75", start, end).error, null);
});

test("capacity probing leaves source, evidence, assignments and unassigned demand unchanged", () => {
  const before = structuredClone([source, capacity]);
  assert.equal(query().eligible_stands, 19);
  assert.equal(queryCapacity(capacity, "baseline", "baw-international", 120, ...horizon).eligible_stands, 4);
  query(1440);
  assert.deepEqual([source, capacity], before);
});
