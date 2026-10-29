import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Occupancy } from "../src/stand-timeline/model.ts";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import { createOperationsDataset } from "../src/operations/dataset.ts";
import { availableOverlays, changeOverlaySelection, EMPTY_OVERLAY_SELECTION } from "../src/overlays/registry.ts";
import { parseBufferProfile, parseGateWaitProfile, validateOverlayData } from "../src/overlays/profiles.ts";
import { gateWaiting, standHandovers } from "../src/overlays/handovers.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/airports/contoso/evaluation/${name}-profile.json`, import.meta.url), "utf8"));
const buffers = parseBufferProfile(read("buffer"));
const waiting = parseGateWaitProfile(read("gate-wait"));
const contoso = await loadSourceDataset({ source: "contoso", plan: "baseline" });

test("overlays register from source data, without Contoso defaults leaking to other sources", async () => {
  for (const plan of ["baseline", "tow-options"] as const) {
    const source = await loadSourceDataset({ source: "contoso", plan });
    assert.deepEqual(availableOverlays(source).map(item => item.id), ["buffers", "gate-wait"]);
    assert.equal(source.overlays?.datasetId, source.id);
    assert.deepEqual(availableOverlays(await loadSourceDataset({ source: "gtaa", plan })), []);
  }
  assert.deepEqual(availableOverlays(await loadSourceDataset({ source: "fixture", plan: "baseline" })), []);
});

test("overlay input validation rejects wrong airports, plans, unsupported data and corrupt profiles", () => {
  const envelope = contoso.overlays!;
  assert.throws(() => validateOverlayData({ ...envelope, airportId: "gtaa" }, contoso), /does not match/);
  assert.throws(() => validateOverlayData({ ...envelope, datasetId: "other-plan" }, contoso), /does not match/);
  assert.throws(() => validateOverlayData({ ...envelope, profiles: { unknown: buffers } }, contoso), /Unregistered/);
  assert.throws(() => validateOverlayData({ ...envelope, profiles: { buffers: { ...buffers, id: "gtaa:buffers" } } }, contoso), /another airport/);
  assert.throws(() => validateOverlayData({ ...envelope, profiles: { buffers: undefined } }, contoso), /profile/);
  assert.throws(() => createOperationsDataset({ ...contoso, capabilities: { editStands: true, fixtureAnalyses: true } }), /read-only/);
  assert.throws(() => createOperationsDataset({ ...contoso, id: "other-source" }), /does not match/);
  assert.throws(() => availableOverlays(contoso, []), /no toolbar registration/);
});

test("duplicate registrations and attempts to enable unavailable overlays explicitly fail", () => {
  const registered = availableOverlays(contoso);
  assert.throws(() => availableOverlays(contoso, [...registered, registered[0]]), /Duplicate/);
  assert.throws(() => changeOverlaySelection(EMPTY_OVERLAY_SELECTION, registered, { type: "toggle", id: "capacity" }), /unavailable/);
});

test("overlay toggle, inspection and reset remain independent and prune unavailable features", () => {
  const registered = availableOverlays(contoso);
  let state = changeOverlaySelection(EMPTY_OVERLAY_SELECTION, registered, { type: "toggle", id: "buffers" });
  state = changeOverlaySelection(state, registered, { type: "toggle", id: "gate-wait" });
  state = changeOverlaySelection(state, registered, { type: "inspect", id: "buffers" });
  assert.deepEqual(state, { enabled: ["buffers", "gate-wait"], review: "buffers" });
  state = changeOverlaySelection(state, registered, { type: "close" });
  assert.deepEqual(state.enabled, ["buffers", "gate-wait"]);
  state = changeOverlaySelection(state, registered, { type: "toggle", id: "buffers" });
  assert.deepEqual(state.enabled, ["gate-wait"]);
  assert.deepEqual(changeOverlaySelection(state, [], { type: "close" }), EMPTY_OVERLAY_SELECTION);
  assert.deepEqual(changeOverlaySelection(state, registered, { type: "reset" }), EMPTY_OVERLAY_SELECTION);
});

test("profiles preserve metric versions, reject invalid thresholds and duplicate assumptions", () => {
  for (const threshold of [-1, 121, NaN, Infinity]) assert.throws(() => parseBufferProfile({ ...buffers, threshold_minutes: threshold }));
  assert.throws(() => parseBufferProfile({ ...buffers, metric_version: "2.0.0" }));
  assert.throws(() => parseBufferProfile({ ...buffers, extra: true }));
  assert.throws(() => parseGateWaitProfile({ ...waiting, assumptions: [waiting.assumptions[0], waiting.assumptions[0]] }));
  assert.throws(() => parseGateWaitProfile({ ...waiting, default_assumption_id: "missing" }));
  assert.throws(() => parseGateWaitProfile({ ...waiting, source: "actual" }));
  assert.throws(() => parseGateWaitProfile({ ...waiting, assumptions: [{ ...waiting.assumptions[0], release_delay_probability: 1.1 }] }));
});

const minute = 60_000;
const stay = (id: string, start: number, end: number, visitId = id, rowId = "stand:1"): Occupancy =>
  ({ id, rowId, visitId, start: start * minute, end: end * minute, kind: "turn" });

test("stand buffers retain zero gaps, same-visit exclusions, exact durations and source ordering", () => {
  const input = [stay("b", 30, 40), stay("a", 0, 10), stay("c", 40, 50), stay("d", 60, 70, "c")];
  const before = structuredClone(input);
  const result = standHandovers(input, [0, 100 * minute]);
  assert.equal(result.availability, "available");
  assert.deepEqual(result.handovers.map(item => item.minutes), [20, 0]);
  assert.deepEqual(input, before);
  assert.equal(result.handovers.filter(item => item.minutes < buffers.threshold_minutes).length, 1, "threshold is strict, not inclusive");
});

test("occupied-union frontier rejects overlap evidence without manufacturing nested gaps", () => {
  const result = standHandovers([stay("a", 0, 100), stay("nested", 10, 20), stay("next", 120, 140)], [0, 200 * minute]);
  assert.equal(result.availability, "invalid");
  assert.deepEqual(result.handovers.map(item => item.minutes), [20]);
  assert.equal(result.handovers[0].previous.id, "a");
});

test("buffer horizon is half-open and empty or unknown-predecessor cases are not applicable", () => {
  assert.equal(standHandovers([], [0, minute]).availability, "not-applicable");
  const result = standHandovers([stay("old", -20, -10), stay("first", 10, 20), stay("outside", 100, 110)], [0, 100 * minute]);
  assert.equal(result.handovers.length, 0);
  assert.throws(() => standHandovers([stay("bad", 10, 10)], [0, minute]), /Invalid/);
  assert.throws(() => standHandovers([stay("a", 0, 1), stay("a", 2, 3)], [0, 10 * minute]), /Invalid/);
  assert.throws(() => standHandovers([], [NaN, minute]), /Invalid/);
});

test("stand buffers include a touching context predecessor but never bridge different stands", () => {
  const result = standHandovers([
    stay("context", -20, 0), stay("arrival", 10, 20),
    stay("other", 30, 40, "other", "stand:2"),
  ], [0, 100 * minute]);
  assert.deepEqual(result.handovers.map(item => item.minutes), [10]);
  assert.equal(result.handovers[0].previous.id, "context");
});

test("waiting uses source probability and conditional mean with explicit assessed populations", () => {
  const occupancies = [stay("first", 0, 10), stay("second", 20, 30), stay("tow", 40, 50)];
  const dataset: Parameters<typeof gateWaiting>[0] = {
    domain: [0, 100 * minute],
    timeline: { occupancies, endpoints: new Map([
      ["first", { start: { kind: "flight", flight: "A1", origin: "AAA" }, end: { kind: "flight", flight: "A2", destination: "BBB" } }],
      ["second", { start: { kind: "flight", flight: "B1", origin: "AAA" }, end: { kind: "none" } }],
      ["tow", { start: { kind: "tow" }, end: { kind: "none" } }],
    ]) },
    arrivals: [
      { id: "arr1", direction: "arrival", flight: "A1", routeEnd: "AAA", estimate: 0, occupancyId: "first", standId: "stand:1" },
      { id: "arr2", direction: "arrival", flight: "B1", routeEnd: "AAA", estimate: 20 * minute, occupancyId: "second", standId: "stand:1" },
      { id: "unassigned", direction: "arrival", flight: "C1", routeEnd: "AAA", estimate: 60 * minute },
      { id: "context", direction: "arrival", flight: "D1", routeEnd: "AAA", estimate: -minute, occupancyId: "context", standId: "stand:1" },
    ],
  };
  const routine = gateWaiting(dataset, waiting.assumptions[0]);
  assert.equal(routine.totalMinutes, 2.5);
  assert.equal(routine.assessed, 1);
  assert.equal(routine.unassessed, 1);
  assert.equal(routine.unassigned, 1);
  assert.equal(routine.context, 1);
  assert.equal(gateWaiting(dataset, waiting.assumptions[1]).totalMinutes, 15);
  assert.throws(() => gateWaiting(dataset, { ...waiting.assumptions[0], release_delay_probability: NaN }), /Invalid/);
  dataset.timeline.occupancies = [stay("first", 0, 25), stay("second", 20, 30)];
  const invalid = gateWaiting(dataset, waiting.assumptions[0]);
  assert.equal(invalid.availability, "invalid");
  assert.equal(invalid.totalMinutes, null);
  assert.equal(invalid.contributions.length, 0);
});

test("waiting distinguishes not applicable from assessed zero and excludes the horizon end", () => {
  const dataset: Parameters<typeof gateWaiting>[0] = {
    domain: [0, 100 * minute],
    timeline: {
      occupancies: [stay("first", 0, 10)],
      endpoints: new Map([["first", { start: { kind: "flight", flight: "A1", origin: "AAA" }, end: { kind: "none" } }]]),
    },
    arrivals: [
      { id: "first", direction: "arrival", flight: "A1", routeEnd: "AAA", estimate: 0, occupancyId: "first", standId: "stand:1" },
      { id: "outside", direction: "arrival", flight: "B1", routeEnd: "AAA", estimate: 100 * minute, occupancyId: "outside", standId: "stand:1" },
    ],
  };
  const empty = gateWaiting(dataset, waiting.assumptions[0]);
  assert.equal(empty.availability, "not-applicable");
  assert.equal(empty.totalMinutes, null);
  assert.equal(empty.context, 1);
  assert.equal(empty.unassessed, 1);
  dataset.timeline.occupancies.push(stay("context", -20, 0));
  const assessed = gateWaiting(dataset, { ...waiting.assumptions[0], release_delay_probability: 0 });
  assert.equal(assessed.availability, "available");
  assert.equal(assessed.assessed, 1);
  assert.equal(assessed.totalMinutes, 0);
  assert.equal(assessed.context, 1);
});

test("Contoso overlays use immutable assigned source stays and do not mutate schedule records", () => {
  const before = structuredClone(contoso);
  const result = standHandovers(contoso.timeline.occupancies, contoso.domain);
  const prediction = gateWaiting(contoso, waiting.assumptions[0]);
  assert.equal(result.availability, "available");
  assert.ok(result.handovers.length > 0);
  assert.equal(prediction.assessed + prediction.unassessed + prediction.context, contoso.arrivals.filter(flight => flight.occupancyId).length);
  for (const contribution of prediction.contributions) {
    assert.equal(contribution.minutes, 0.25 * Math.max(0, 20 - contribution.handover.minutes));
    assert.ok(contoso.flightsById.has(contribution.arrival.id));
  }
  assert.deepEqual(contoso, before);
});
