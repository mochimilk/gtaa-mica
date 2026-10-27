// The snapshot the interpreter and the executor see.
import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, describeSnapshot } from "../src/live/opsHost.ts";
import { injectionByteLength } from "../src/live/liveEvents.ts";
import { EMPTY_FILTERS } from "../src/operations/opsFilters.ts";

const base = {
  revision: 3,
  view: "all" as const,
  filters: EMPTY_FILTERS,
  acknowledged: new Set<string>(),
  selection: { occupancyIds: [] as string[], flightId: null as string | null },
};

test("a list selection resolves to its flight", () => {
  const snapshot = buildSnapshot({ ...base, selection: { occupancyIds: ["T01-1"], flightId: "T01-ARR" } });
  assert.equal(snapshot.selection.flightNumber, "XA101");
  assert.equal(snapshot.selection.standId, "A1");
  assert.deepEqual(
    snapshot.selection.flights.map((entry) => entry.id),
    ["T01-ARR"],
  );
});

test("a chart selection resolves to the flights at those stays", () => {
  // The gap this closes: a chart selection has no flightId, so without
  // resolving occupancies the interpreter could only see a count and could
  // never answer "that flight" or "the selected one".
  const snapshot = buildSnapshot({ ...base, selection: { occupancyIds: ["T01-1"], flightId: null } });

  assert.equal(snapshot.selection.flightId, null);
  assert.equal(snapshot.selection.flightNumber, null);
  // One stay carries both an arrival and a departure, so ambiguity stays visible.
  assert.deepEqual(
    snapshot.selection.flights.map((entry) => `${entry.flight}/${entry.direction}`),
    ["XA101/arrival", "XA102/departure"],
  );
  assert.ok(snapshot.selection.flights.every((entry) => entry.standId === "A1"));

  const many = buildSnapshot({ ...base, selection: { occupancyIds: ["T01-1", "T02-1"], flightId: null } });
  assert.equal(many.selection.flights.length, 4);
});

test("an unknown occupancy resolves to no flight rather than throwing", () => {
  const snapshot = buildSnapshot({ ...base, selection: { occupancyIds: ["NOPE"], flightId: null } });
  assert.deepEqual(snapshot.selection.flights, []);
  assert.deepEqual(snapshot.selection.occupancyIds, ["NOPE"]);
});

test("counts follow the view and filters", () => {
  const all = buildSnapshot(base);
  assert.equal(all.matchingFlights, all.totalFlights);

  const arrivals = buildSnapshot({ ...base, view: "arrivals" });
  assert.ok(arrivals.matchingFlights < arrivals.totalFlights);
  assert.equal(arrivals.viewLabel, "Arrivals");

  const carrier = buildSnapshot({ ...base, filters: { ...EMPTY_FILTERS, carrier: ["XA"] } });
  assert.ok(carrier.matchingFlights < carrier.totalFlights);
});

test("acknowledging an alert removes it from the open list", () => {
  const before = buildSnapshot(base);
  assert.ok(before.openAlerts.some((alert) => alert.id === "ALERT-U01"));

  const after = buildSnapshot({ ...base, acknowledged: new Set(["ALERT-U01"]) });
  assert.equal(after.openAlerts.some((alert) => alert.id === "ALERT-U01"), false);
  assert.deepEqual(after.acknowledgedAlertIds, ["ALERT-U01"]);
});

test("the spoken-context summary stays inside the injection byte budget", () => {
  // Worst realistic case: every filter dimension full, a wide selection and
  // every alert open.
  const snapshot = buildSnapshot({
    revision: 99,
    view: "attention",
    filters: { carrier: ["XA", "XB", "XC", "XD"], area: ["Pier A", "Pier B", "Remote"], type: ["A320", "B738"] },
    acknowledged: new Set(),
    selection: { occupancyIds: ["T01-1", "T02-1", "T03-1"], flightId: null },
  });

  const described = describeSnapshot(snapshot);
  assert.ok(
    injectionByteLength(described) <= 480,
    `context summary is ${injectionByteLength(described)} bytes`,
  );
  // Still says the things that matter.
  assert.ok(described.includes("synthetic"));
  assert.ok(described.includes("Needs attention"));
  assert.ok(/\d+\/\d+ flights match/.test(described));
});

test("the summary names a chart selection's flights", () => {
  const described = describeSnapshot(
    buildSnapshot({ ...base, selection: { occupancyIds: ["T01-1"], flightId: null } }),
  );
  assert.ok(described.includes("XA101"));
});

test("an empty board reads as empty, not as missing", () => {
  const described = describeSnapshot(buildSnapshot({ ...base, acknowledged: new Set([]) }));
  assert.ok(described.includes("Nothing selected."));
  assert.ok(described.includes("No filters."));
});
