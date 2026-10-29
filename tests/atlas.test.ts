import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import { createOperationsDataset } from "../src/operations/dataset.ts";
import { availableOverlays } from "../src/overlays/registry.ts";
import { buildDecisionSummary } from "../src/overlays/decisionSummary.ts";
import { atlasFrequency, atlasRate, atlasSegments, inspectAtlas, isAtlasMode, parseAtlas,
  validateAtlasCapacity, validateAtlasDataset, type PreparedAtlas } from "../src/overlays/atlas.ts";
import { fingerprintJson, parseCapacitySnapshot, queryCapacity, type CapacityOpportunity } from "../src/overlays/capacity.ts";

const read = (suffix: string) => JSON.parse(readFileSync(new URL(`../src/data-sources/prepared/contoso/full-day${suffix}.json`, import.meta.url), "utf8"));
const atlas = parseAtlas(read(".atlas")), capacity = parseCapacitySnapshot(read(".capacity"));
const origin = Date.parse(capacity.plan_window.start), end = Date.parse(capacity.plan_window.end);
const probeId = capacity.profile.default_probe_id;
const minute = 60_000;
const ranges = queryCapacity(capacity, "baseline", probeId, 75, origin, end).opportunities;

test("Atlas binds exact capacity, source envelope and both request fingerprints", async () => {
  assert.deepEqual(await validateAtlasCapacity(atlas, capacity), atlas);
  assert.equal(atlas.capacity_fingerprint, await fingerprintJson(capacity));
  for (const key of ["airport_id", "case_id", "demand_id", "snapshot_fingerprint", "airport_fingerprint", "demand_fingerprint", "capacity_fingerprint"] as const) {
    const changed = structuredClone(atlas);
    changed[key] = key.endsWith("fingerprint") ? "0".repeat(64) : "other";
    await assert.rejects(validateAtlasCapacity(changed, capacity));
  }
  for (const variant of ["baseline", "tow-options"] as const) {
    const changed = structuredClone(atlas);
    changed.variants[variant].request_fingerprint = "0".repeat(64);
    await assert.rejects(validateAtlasCapacity(changed, capacity), /request/);
  }
  const changed = structuredClone(capacity);
  changed.profile.probes[0].label += " changed";
  await assert.rejects(validateAtlasCapacity(atlas, changed), /exact capacity/);
});

const malformed: [string, (value: PreparedAtlas) => void][] = [
  ["version", value => { Object.assign(value, { schema_version: "1.0.0" }); }],
  ["unknown field", value => { Object.assign(value, { observed: true }); }],
  ["calendar overflow", value => { value.profile.start_date = "2026-02-30"; }],
  ["wrong date sequence", value => { value.days[1].date = value.days[0].date; }],
  ["missing day", value => { value.days.pop(); }],
  ["reversed range", value => { value.profile.planned_shift_minutes = [30, -30]; }],
  ["out-of-range parameter", value => { value.days[0].parameters.planned_shift_minutes = 31; }],
  ["wrong profile airport", value => { value.profile.id = "gtaa:atlas"; }],
  ["horizon mismatch", value => { value.horizon_duration_ms -= 1; }],
  ["invalid UTC calendar", value => { value.plan_window.start = "2026-02-30T00:00:00Z"; }],
  ["negative window", value => { value.days[0].variants.baseline.planned[0].rows[0].windows = [[-1, 100]]; }],
  ["reversed window", value => { value.days[0].variants.baseline.planned[0].rows[0].windows = [[100, 50]]; }],
  ["overlapping windows", value => { value.days[0].variants.baseline.planned[0].rows[0].windows = [[0, 100], [99, 200]]; }],
  ["adjacent unmerged windows", value => { value.days[0].variants.baseline.planned[0].rows[0].windows = [[0, 100], [100, 200]]; }],
  ["fractional timestamp", value => { value.days[0].variants.baseline.planned[0].rows[0].windows = [[0.5, 100]]; }],
  ["outside horizon", value => { value.days[0].variants.baseline.planned[0].rows[0].windows = [[0, value.horizon_duration_ms + 1]]; }],
];
for (const [name, corrupt] of malformed) test(`Atlas rejects ${name}`, () => {
  const changed = structuredClone(atlas); corrupt(changed);
  assert.throws(() => parseAtlas(changed));
});

test("every phase of both plans requires exactly the capacity probes and eligible stands", async () => {
  for (const variant of ["baseline", "tow-options"] as const) for (const phase of ["planned", "end_of_day"] as const) {
    for (const corrupt of [
      (value: PreparedAtlas) => { value.days[1].variants[variant][phase].pop(); },
      (value: PreparedAtlas) => { value.days[1].variants[variant][phase][1] = value.days[1].variants[variant][phase][0]; },
      (value: PreparedAtlas) => { value.days[1].variants[variant][phase][0].rows.pop(); },
      (value: PreparedAtlas) => { value.days[1].variants[variant][phase][0].rows[1] = value.days[1].variants[variant][phase][0].rows[0]; },
      (value: PreparedAtlas) => { value.days[1].variants[variant][phase][0].rows[0].stand_id = "unknown"; },
    ]) {
      const changed = structuredClone(atlas); corrupt(changed);
      await assert.rejects(validateAtlasCapacity(changed, capacity), /Incomplete Atlas/);
    }
  }
});

function smallAtlas() {
  const value = structuredClone(atlas);
  value.profile.day_count = 2;
  value.days = value.days.slice(0, 2);
  for (const [index, day] of value.days.entries()) for (const plan of Object.values(day.variants)) {
    // Both days have the same counts, but different daily membership across the two starts.
    plan.planned = [{ id: "probe", rows: [{ stand_id: "A", windows: index === 0 ? [[0, minute]] : [[1, minute + 1]] }] }];
    plan.end_of_day = structuredClone(plan.planned);
  }
  return parseAtlas(value);
}
const item: CapacityOpportunity = { id: "range", rowId: "A", earliest: origin, latest: origin + 1,
  availableStart: origin, availableEnd: origin + minute + 1, before: null, after: null };

test("frequency uses inclusive whole-occupancy fits and conditional retention", () => {
  const value = smallAtlas(), before = JSON.stringify(value);
  const frequency = atlasFrequency(value, "baseline", "probe", "A", 0, 1);
  assert.equal(frequency.planned_days, 1);
  assert.equal(frequency.planned_rate, 0.5);
  assert.equal(frequency.retention_rate, 1);
  assert.deepEqual(frequency.days.map(day => day.planned), [true, false]);
  assert.deepEqual(atlasFrequency(value, "tow-options", "probe", "A", 1, 1).days.map(day => day.planned), [false, true]);
  const empty = atlasFrequency(value, "baseline", "probe", "A", 2, 1);
  assert.equal(empty.planned_rate, 0);
  assert.equal(empty.end_of_day_rate, 0);
  assert.equal(empty.retention_rate, null);
  value.days[0].variants.baseline.end_of_day[0].rows[0].windows = [];
  const lost = atlasFrequency(value, "baseline", "probe", "A", 0, 1);
  assert.equal(lost.retention_rate, 0);
  assert.equal(atlasRate(lost, "planned"), 0.5);
  assert.equal(atlasRate(lost, "end_of_day"), 0);
  assert.equal(atlasRate(lost, "retention"), 0);
  assert.equal(JSON.stringify(smallAtlas()), before);
});

test("segmentation preserves exact final starts without attaching stale daily evidence to equal-count merges", () => {
  const value = smallAtlas();
  const segments = atlasSegments(value, "baseline", "probe", item, 1, origin);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments.map(segment => [segment.start, segment.end]), [[origin, origin + 2]]);
  assert.equal(Object.hasOwn(segments[0].frequency, "days"), false);
  assert.deepEqual(atlasFrequency(value, "baseline", "probe", "A", 0, 1).days.map(day => day.planned), [true, false]);
  assert.deepEqual(atlasFrequency(value, "baseline", "probe", "A", 1, 1).days.map(day => day.planned), [false, true]);
  const point = atlasSegments(value, "baseline", "probe", { ...item, latest: origin }, 1, origin);
  assert.equal(point.length, 1);
  assert.equal(point[0].end - point[0].start, 1);
  for (const day of value.days) for (const plan of Object.values(day.variants)) for (const phase of Object.values(plan)) {
    phase[0].rows[0].windows = [[0, minute + 1]];
  }
  assert.equal(atlasSegments(value, "baseline", "probe", item, 1, origin).length, 1);
  assert.throws(() => atlasSegments(value, "baseline", "probe", item, 1, origin + 1), /source/);
});

test("point inspection rejects invalid UTC input and out-of-band starts, without stale results", () => {
  const value = smallAtlas();
  assert.equal(inspectAtlas(value, "baseline", "probe", 1, [item], null).frequency?.planned_days, 1);
  for (const start of ["", "2026-02-30T00:00", new Date(origin - 1).toISOString().slice(0, -1), new Date(origin + 2).toISOString().slice(0, -1)]) {
    const result = inspectAtlas(value, "baseline", "probe", 1, [item], { bandId: item.id, start });
    assert.match(result.error!, /valid UTC/);
    assert.equal(result.frequency, null);
  }
  assert.equal(inspectAtlas(value, "baseline", "probe", 1, [item],
    { bandId: "missing", start: new Date(origin).toISOString().slice(0, -1) }).selected, null);
  assert.equal(inspectAtlas(value, "baseline", "probe", 1, [], null).frequency, null);
});

test("exact-time inspection accepts the browser's one-to-three-digit fractional seconds", () => {
  for (const fraction of ["1", "01", "001"]) {
    const start = new Date(origin).toISOString().replace(".000Z", `.${fraction}`);
    const result = inspectAtlas(smallAtlas(), "baseline", "probe", 1, [{ ...item, latest: origin + 1000 }],
      { bandId: item.id, start });
    assert.equal(result.error, null);
    assert.notEqual(result.frequency, null);
  }
});

test("invalid frequency arguments and non-frequency modes fail explicitly", () => {
  const value = smallAtlas();
  for (const [offset, duration] of [[-1, 1], [0.1, 1], [0, 0], [0, 1441], [0, 1.5], [value.horizon_duration_ms, 1]]) {
    assert.throws(() => atlasFrequency(value, "baseline", "probe", "A", offset, duration), /query/);
  }
  assert.throws(() => atlasFrequency(value, "baseline", "missing", "A", 0, 1), /Unknown/);
  assert.equal(isAtlasMode("current"), true);
  assert.equal(isAtlasMode("toString"), false);
  assert.equal(isAtlasMode("unknown"), false);
  // Runtime callers cannot silently fall back to planned frequency.
  assert.throws(() => Reflect.apply(atlasRate, undefined, [atlasFrequency(value, "baseline", "probe", "A", 0, 1), "current"]), /Unknown/);
});

test("real current bands split into contiguous, exact frequency segments without source mutation", () => {
  const before = JSON.stringify(atlas);
  for (const variant of ["baseline", "tow-options"] as const) {
    for (const opportunity of queryCapacity(capacity, variant, probeId, 75, origin, end).opportunities) {
      const segments = atlasSegments(atlas, variant, probeId, opportunity, 75, origin);
      assert.equal(segments[0].start, opportunity.earliest);
      assert.equal(segments.at(-1)!.end, opportunity.latest + 1);
      for (const [index, segment] of segments.entries()) {
        if (index) assert.equal(segment.start, segments[index - 1].end);
        const { days: _days, ...expected } = atlasFrequency(atlas, variant, probeId, opportunity.rowId, segment.end - 1 - origin, 75);
        assert.deepEqual(segment.frequency, expected);
      }
    }
  }
  assert.equal(JSON.stringify(atlas), before);
  assert.equal(ranges.length, 55);
});

test("companions are optional, source-bound, non-toolbar evidence; current summary is unaffected", async () => {
  for (const variant of ["baseline", "tow-options"] as const) {
    const dataset = await loadSourceDataset({ source: "contoso", plan: variant });
    assert.doesNotThrow(() => validateAtlasDataset(atlas, dataset, dataset.overlays!.profiles));
    const summary = buildDecisionSummary(dataset);
    const overlays = { ...dataset.overlays!, companions: undefined };
    const without = createOperationsDataset({ ...dataset, overlays });
    assert.deepEqual(buildDecisionSummary(without), summary);
    assert.equal(availableOverlays(dataset).length, availableOverlays(without).length);
    assert.equal(availableOverlays(dataset).length, 6);
    assert.throws(() => createOperationsDataset({ ...dataset, overlays: {
      ...overlays, companions: { unknown: atlas },
    } }), /Unregistered/);
    assert.throws(() => createOperationsDataset({ ...dataset, overlays: {
      ...overlays, profiles: {}, companions: { "capacity-atlas": atlas },
    } }), /requires/);
    assert.throws(() => createOperationsDataset({ ...dataset, overlays: {
      ...overlays, companions: { "capacity-atlas": {} },
    } }), /Atlas/);
    // Validate the supplied envelope, not the dataset's old profile object.
    const other = structuredClone(capacity);
    other.snapshot_fingerprint = "0".repeat(64);
    assert.throws(() => validateAtlasDataset(atlas, dataset, { capacity: other }));
  }
  for (const source of ["fixture", "gtaa"] as const) {
    assert.equal((await loadSourceDataset({ source, plan: "baseline" })).overlays, undefined);
  }
});
