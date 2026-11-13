import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ACTIVE_DATASET } from "../src/operations/activeDataset.ts";
import { applyPlan, occupancyById, resetStands } from "../src/operations/allocation.ts";
import {
  createOperationsDataset,
  type OperationsDatasetInput,
} from "../src/operations/dataset.ts";
import {
  ARRIVALS,
  DEPARTURES,
  NO_STAND_STAYS,
  OPS_FLIGHTS,
  OPS_FLIGHTS_BY_ID,
} from "../src/operations/operationsData.ts";
import { buildSnapshot } from "../src/live/opsHost.ts";
import { EMPTY_FILTERS } from "../src/operations/opsFilters.ts";
import { adaptSyntheticDay, utcAt } from "../src/stand-timeline-demo/adapter.ts";
import { DEMO_DATA, DEMO_DOMAIN, dayOffset, formatUtcWithDay } from "../src/stand-timeline-demo/demoData.ts";
import { createFixtureDataset } from "../src/stand-timeline-demo/fixtureDataset.ts";
import {
  SYNTHETIC_DATE,
  SYNTHETIC_STANDS,
  SYNTHETIC_TURNS,
  SYNTHETIC_WINDOW,
} from "../src/stand-timeline-demo/syntheticFixture.ts";

afterEach(() => resetStands());

function otherSource(overrides: Partial<OperationsDatasetInput> = {}): OperationsDatasetInput {
  const start = Date.parse("2026-03-10T09:00:00Z");
  const end = start + 3_600_000;
  const visitId = "other:visit:1";
  const occupancyId = "other:stay:1";
  const standId = "other:stand:9";
  return {
    id: "other-source",
    label: "Other source",
    airportId: "other-airport",
    date: "2026-03-10",
    domain: [start, end],
    stands: [{ code: standId, area: "Other terminal", size: "wide" }],
    aircraftSizes: { X1: "wide" },
    aircraftMakers: { X1: "Other maker" },
    timeline: {
      rows: [{ id: standId, label: "9", group: "Other terminal" }],
      visits: [{ id: visitId, label: "ZZ12/13" }],
      occupancies: [{ id: occupancyId, visitId, rowId: standId, start, end, kind: "turn" }],
      turnsById: new Map([[visitId, {
        turnId: visitId, carrier: "ZZ", arrFlight: "ZZ12", depFlight: "ZZ13",
        origin: "AAA", destination: "BBB", registration: "OTHER", aircraftType: "X1", stays: [],
      }]]),
      stayPosition: new Map([[occupancyId, { index: 0, count: 1 }]]),
      endpoints: new Map([[occupancyId, {
        start: { kind: "flight", flight: "ZZ12", origin: "AAA" },
        end: { kind: "flight", flight: "ZZ13", destination: "BBB" },
      }]]),
      delays: new Map(),
    },
    flights: [
      { id: "source-leg:arrival", direction: "arrival", flight: "ZZ12", routeEnd: "AAA",
        estimate: start, occupancyId, visitId, standId, standStart: start, standEnd: end },
      { id: "source-leg:departure", direction: "departure", flight: "ZZ13", routeEnd: "BBB",
        estimate: end, occupancyId, visitId, standId, standStart: start, standEnd: end },
    ],
    noStandStays: [],
    ...overrides,
  };
}

test("chart, lists, editor and agent use the same owned fixture records", () => {
  assert.equal(DEMO_DATA, ACTIVE_DATASET.timeline);
  assert.equal(DEMO_DOMAIN, ACTIVE_DATASET.domain);
  assert.equal(OPS_FLIGHTS, ACTIVE_DATASET.flights);
  assert.equal(OPS_FLIGHTS_BY_ID, ACTIVE_DATASET.flightsById);
  assert.equal(ARRIVALS, ACTIVE_DATASET.arrivals);
  assert.equal(DEPARTURES, ACTIVE_DATASET.departures);
  assert.equal(NO_STAND_STAYS, ACTIVE_DATASET.noStandStays);
  for (const flight of OPS_FLIGHTS) {
    assert.equal(OPS_FLIGHTS_BY_ID.get(flight.id), flight);
    if (flight.occupancyId) {
      assert.equal(occupancyById(flight.occupancyId),
        DEMO_DATA.occupancies.find((stay) => stay.id === flight.occupancyId));
    }
  }
});

test("fixture construction preserves stays, domain, UTC day offsets and untimed waiting flights", () => {
  const fixture = createFixtureDataset();
  const original = adaptSyntheticDay(SYNTHETIC_DATE, SYNTHETIC_STANDS, SYNTHETIC_TURNS);
  assert.deepEqual(fixture.timeline.occupancies, original.occupancies);
  assert.deepEqual(fixture.domain, [
    utcAt(SYNTHETIC_DATE, SYNTHETIC_WINDOW.from),
    utcAt(SYNTHETIC_DATE, SYNTHETIC_WINDOW.to),
  ]);
  assert.deepEqual(fixture.stands, SYNTHETIC_STANDS);
  assert.equal(fixture.timeline.visits.length, original.visits.length + 4);
  assert.equal(fixture.noStandStays.length, 4);
  assert.equal(fixture.flights.filter((flight) => !flight.standId).length, 5);
  assert.equal(fixture.flightsById.get("U05")?.unplacedStay, undefined);
  assert.equal(fixture.flightsById.get("U01")?.visitId, "U01");
  assert.equal(fixture.timeline.endpoints.get("U04-1")?.end.kind, "flight");
  assert.equal(dayOffset(utcAt(SYNTHETIC_DATE, "22:30", -1)), -1);
  assert.equal(formatUtcWithDay(utcAt(SYNTHETIC_DATE, "05:00")), "05:00");
  assert.equal(dayOffset(utcAt(SYNTHETIC_DATE, "00:00", 1)), 1);
});

test("creating another fixture never re-registers no-stand visits or changes the active board", () => {
  const before = structuredClone(ACTIVE_DATASET);
  const first = createFixtureDataset();
  const second = createFixtureDataset();
  assert.deepEqual(ACTIVE_DATASET, before);
  assert.deepEqual(first, second);
  assert.notEqual(first.timeline, second.timeline);
  first.timeline.occupancies[0].rowId = "changed";
  first.flights[0].standId = "changed";
  first.timeline.turnsById.clear();
  assert.notEqual(second.timeline.occupancies[0].rowId, "changed");
  assert.notEqual(second.flights[0].standId, "changed");
  assert.ok(second.timeline.turnsById.size > 0);
  assert.deepEqual(ACTIVE_DATASET, before);
});

test("a non-fixture source retains its exact IDs and metadata without fixture flights or stands", () => {
  const input = otherSource();
  const data = createOperationsDataset(input);
  assert.equal(data.id, "other-source");
  assert.equal(data.airportId, "other-airport");
  assert.equal(data.date, "2026-03-10");
  assert.deepEqual(data.stands.map((stand) => stand.code), ["other:stand:9"]);
  assert.deepEqual(data.flights.map((flight) => flight.id), ["source-leg:arrival", "source-leg:departure"]);
  assert.equal(data.flightsById.get("U01"), undefined);
  assert.deepEqual(data.aircraftMakers, { X1: "Other maker" });
  assert.deepEqual(data.aircraftSizes, { X1: "wide" });
  assert.equal(data.arrivals[0], data.flightsById.get("source-leg:arrival"));
  assert.equal(data.departures[0], data.flightsById.get("source-leg:departure"));
  assert.notEqual(data.timeline.occupancies[0], input.timeline.occupancies[0]);
  assert.notEqual(data.timeline.turnsById, input.timeline.turnsById);
  data.timeline.occupancies[0].rowId = "changed";
  data.flights[0].standId = "changed";
  assert.equal(input.timeline.occupancies[0].rowId, "other:stand:9");
  assert.equal(input.flights[0].standId, "other:stand:9");
});

test("invalid source identity, date and domain fail explicitly", () => {
  for (const id of ["", " "]) {
    assert.throws(() => createOperationsDataset(otherSource({ id })), /source ID/);
  }
  for (const date of ["not-a-date", "2026-02-30", "2026-3-10"]) {
    assert.throws(() => createOperationsDataset(otherSource({ date })), /invalid UTC reference date/);
  }
  for (const domain of [[NaN, 1], [1, Infinity], [1, 1], [2, 1]] as const) {
    assert.throws(() => createOperationsDataset(otherSource({ domain })), /finite and increasing/);
  }
});

test("duplicate identifiers and inconsistent stand or visit metadata are rejected", () => {
  const cases: { change: (input: OperationsDatasetInput) => void; message: RegExp }[] = [
    { change: (input) => input.flights.push({ ...input.flights[0] }), message: /duplicate flight ID/ },
    { change: (input) => input.timeline.rows.push({ ...input.timeline.rows[0] }), message: /duplicate row ID/ },
    { change: (input) => input.timeline.visits.push({ ...input.timeline.visits[0] }), message: /duplicate visit ID/ },
    { change: (input) => input.noStandStays.push({ ...input.timeline.occupancies[0] }), message: /duplicate stay ID/ },
    { change: (input) => input.timeline.rows.splice(0), message: /stand metadata must match/ },
    { change: (input) => { input.timeline.rows[0].group = "Foreign area"; }, message: /inconsistent area/ },
    { change: (input) => input.timeline.endpoints.clear(), message: /missing visit or endpoint/ },
    { change: (input) => input.timeline.turnsById.clear(), message: /missing visit or endpoint/ },
    { change: (input) => { input.timeline.occupancies[0].rowId = "A1"; }, message: /invalid stand/ },
    { change: (input) => { input.timeline.occupancies[0].end = NaN; }, message: /increasing interval/ },
  ];
  for (const { change, message } of cases) {
    const input = otherSource();
    change(input);
    assert.throws(() => createOperationsDataset(input), message);
  }
});

test("flights cannot point at a foreign stand, visit or assigned stay", () => {
  const cases: { change: (input: OperationsDatasetInput) => void; message: RegExp }[] = [
    { change: (input) => { input.flights[0].standId = "A1"; }, message: /does not match its assigned stay/ },
    { change: (input) => { input.flights[0].visitId = "foreign"; }, message: /does not match its assigned stay/ },
    { change: (input) => { input.flights[0].occupancyId = "foreign"; }, message: /does not match its assigned stay/ },
    { change: (input) => { input.flights[0].standStart = 0; }, message: /does not match its assigned stay/ },
    { change: (input) => { input.flights[0].estimate = NaN; }, message: /finite estimate/ },
    { change: (input) => { delete input.flights[0].occupancyId; }, message: /stand details without/ },
    { change: (input) => {
      input.flights[0].unplacedStay = { stayId: "foreign", start: 0, end: 1 };
    }, message: /does not match its assigned stay/ },
  ];
  for (const { change, message } of cases) {
    const input = otherSource();
    change(input);
    assert.throws(() => createOperationsDataset(input), message);
  }
});

test("unplaced stays use source-owned metadata and reject mismatched waiting intervals", () => {
  const input = otherSource();
  const [stay] = input.timeline.occupancies.splice(0);
  stay.rowId = "";
  input.noStandStays.push(stay);
  for (const flight of input.flights) {
    delete flight.occupancyId;
    delete flight.standId;
    delete flight.standStart;
    delete flight.standEnd;
    flight.unplacedStay = { stayId: stay.id, start: stay.start, end: stay.end };
  }
  const data = createOperationsDataset(input);
  assert.equal(data.timeline.occupancies.length, 0);
  assert.deepEqual(data.noStandStays.map((entry) => entry.id), ["other:stay:1"]);
  assert.equal(data.flightsById.get("source-leg:arrival")?.unplacedStay?.stayId, "other:stay:1");
  assert.equal(data.flightsById.get("U01"), undefined);
  const waiting = input.flights[0].unplacedStay;
  assert.ok(waiting);
  waiting.end += 1;
  assert.throws(() => createOperationsDataset(input), /does not match its unplaced stay/);
});

test("a stand change and reset stay visible through the dataset, lists and agent snapshot", () => {
  const snapshot = () => buildSnapshot({
    revision: 1, view: "all", filters: EMPTY_FILTERS, acknowledged: new Set(),
    selection: { occupancyIds: ["T01-1"], flightId: "T01-ARR" },
  });
  assert.equal(applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" }), true);
  assert.equal(ACTIVE_DATASET.timeline.occupancies.find((stay) => stay.id === "T01-1")?.rowId, "C25");
  assert.equal(ACTIVE_DATASET.flightsById.get("T01-ARR")?.standId, "C25");
  assert.equal(ARRIVALS.find((flight) => flight.id === "T01-ARR")?.standId, "C25");
  assert.equal(snapshot().selection.standId, "C25");
  resetStands();
  assert.equal(ACTIVE_DATASET.timeline.occupancies.find((stay) => stay.id === "T01-1")?.rowId, "A1");
  assert.equal(ACTIVE_DATASET.flightsById.get("T01-ARR")?.standId, "A1");
  assert.equal(snapshot().selection.standId, "A1");
});
