import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { adaptPreparedSchedule } from "../src/data-sources/preparedAdapter.ts";
import type { PlanVariant, PreparedScenario } from "../src/data-sources/preparedTypes.ts";
import { loadSourceDataset, readSourceSelection, sourceSelectionUrl } from "../src/data-sources/registry.ts";

function snapshot(airport = "gtaa"): PreparedScenario {
  return JSON.parse(readFileSync(new URL(`../src/data-sources/prepared/${airport}/full-day.json`, import.meta.url), "utf8"));
}

test("test resolver supports Vite-style JSON imports without overriding explicit import metadata", async () => {
  const { default: source } = await import("../src/data-sources/prepared/contoso/full-day.json");
  assert.equal(source.airport.id, "contoso");
  assert.equal(source.case_id, "full-day");
  await assert.rejects(import("../src/data-sources/prepared/contoso/full-day.json", { with: { type: "javascript" } }),
    { code: "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED" });
});

for (const airport of ["gtaa", "contoso"]) {
  for (const variant of ["baseline", "tow-options"] satisfies PlanVariant[]) {
    test(`${airport}/${variant} preserves exact source identifiers, coverage and waiting visits`, () => {
      const source = snapshot(airport);
      const dataset = adaptPreparedSchedule(source, { airportId: airport, caseId: "full-day" }, variant);
      assert.equal(dataset.flights.length, 320);
      assert.equal(dataset.timeline.visits.length, 160);
      assert.deepEqual(dataset.flights.map(flight => flight.id), source.flights.map(flight => flight.id));
      assert.deepEqual(dataset.timeline.rows, source.rows);
      assert.deepEqual(dataset.timeline.occupancies.map(stay => stay.id).sort(), source.variants[variant].stays.map(stay => stay.id).sort());
      assert.equal(dataset.flights.filter(flight => flight.standId).length, source.variants[variant].covered_flight_count);
      assert.equal(dataset.noStandStays.length, airport === "gtaa" ? 0 : 11);
      assert.equal(dataset.flights.filter(flight => flight.unplacedStay).length, airport === "gtaa" ? 0 : 22);
      for (const stay of dataset.noStandStays) {
        const pair = dataset.flights.filter(flight => flight.unplacedStay?.stayId === stay.id);
        assert.equal(pair.length, 2);
        assert.equal(pair.find(flight => flight.direction === "arrival")?.estimate, stay.start);
        assert.equal(pair.find(flight => flight.direction === "departure")?.estimate, stay.end);
        assert.equal(dataset.timeline.stayPosition.get(stay.id)?.count, 1);
        assert.ok(dataset.timeline.endpoints.has(stay.id));
      }
      assert.deepEqual(dataset.capabilities, { editStands: false, fixtureAnalyses: false });
      assert.ok(dataset.stands.every(stand => stand.size === undefined));
      assert.deepEqual(dataset.aircraftSizes, {});
      assert.equal(dataset.timeline.delays.size, 0);
      assert.ok(!dataset.flights.some(flight => /^(T\d+-|U\d+)/.test(flight.id)));
      assert.match(dataset.summary!, /not operational certification/);
      if (airport === "gtaa") {
        assert.ok(dataset.stands.every(stand => /^(t1|t3|ifc):stand:/.test(stand.code)));
        assert.ok(dataset.flights.every(flight => flight.aircraftType?.startsWith("gtaa:aircraft:")));
      }
      assert.deepEqual(source, snapshot(airport), "adapter must not mutate source snapshots");
    });
  }
}

test("registry validates URL selections and preserves unrelated parameters and fragments", async () => {
  assert.deepEqual(readSourceSelection(""), { source: "fixture", scenario: "original", plan: "baseline" });
  assert.deepEqual(readSourceSelection("?source=gtaa&plan=tow-options"), { source: "gtaa", scenario: "full-day", plan: "tow-options" });
  assert.throws(() => readSourceSelection("?source=missing"), /Unknown/);
  assert.throws(() => readSourceSelection("?source=fixture&plan=tow-options"), /Unknown/);
  const url = new URL(sourceSelectionUrl(new URL("http://localhost/?theme=dark#studio"), { source: "contoso", plan: "baseline" }));
  assert.equal(url.searchParams.get("theme"), "dark");
  assert.equal(url.hash, "#studio");
  assert.equal((await loadSourceDataset({ source: "gtaa", plan: "baseline" })).airportId, "gtaa");
  assert.equal((await loadSourceDataset({ source: "fixture", plan: "baseline" })).capabilities.editStands, true);
  await assert.rejects(loadSourceDataset({ source: "missing", plan: "baseline" }), /Unknown/);
});

test("prepared loader rejects malformed schema and wrong airport or case instead of falling back", () => {
  assert.throws(() => adaptPreparedSchedule({}, { airportId: "gtaa", caseId: "full-day" }, "baseline"), /Invalid prepared schedule/);
  for (const expected of [{ airportId: "contoso", caseId: "full-day" }, { airportId: "gtaa", caseId: "constrained" }]) {
    assert.throws(() => adaptPreparedSchedule(snapshot(), expected, "baseline"), /identity/);
  }
  const missing = snapshot();
  delete missing.airport;
  assert.throws(() => adaptPreparedSchedule(missing, { airportId: "gtaa", caseId: "full-day" }, "baseline"), /identity/);
});

const corruptions: [string, (source: PreparedScenario) => void][] = [
  ["duplicate flight", source => { source.flights.push(source.flights[0]); }],
  ["duplicate visit", source => { source.visits.push(source.visits[0]); }],
  ["unknown flight visit", source => { source.flights[0].visitId = "missing"; }],
  ["unknown stand", source => { source.variants.baseline.stays[0].rowId = "missing"; }],
  ["unknown endpoint", source => { source.variants.baseline.stays[0].arrivalFlightId = "missing"; }],
  ["bad coverage", source => { source.variants.baseline.covered_flight_count -= 2; }],
  ["bad tow counts", source => { source.variants.baseline.generated_movement_count = 2; }],
  ["reversed stay", source => { const stay = source.variants.baseline.stays[0]; stay.end = stay.start; }],
  ["invalid UTC calendar date", source => { source.plan_window.start = "2026-02-30T00:00:00Z"; }],
  ["partial visit", source => { delete source.variants.baseline.stays[0].departureFlightId; }],
  ["incorrect visit flight metadata", source => { source.visits[0].arrFlight = "wrong"; }],
];
for (const [name, corrupt] of corruptions) {
  test(`prepared semantic validation rejects ${name}`, () => {
    const source = snapshot();
    corrupt(source);
    assert.throws(() => adaptPreparedSchedule(source, { airportId: "gtaa", caseId: "full-day" }, "baseline"));
  });
}

function towSnapshot(): PreparedScenario {
  const source = snapshot();
  const visit = source.visits[0];
  source.visits = [visit];
  source.flights = source.flights.filter(flight => flight.visitId === visit.turnId);
  const arrival = source.flights.find(flight => flight.direction === "arrival")!;
  const departure = source.flights.find(flight => flight.direction === "departure")!;
  arrival.scheduled = "2026-10-28T09:00:00Z";
  departure.scheduled = "2026-10-28T12:00:00Z";
  source.variants.baseline.covered_flight_count = 2;
  source.variants.baseline.generated_movement_count = 2;
  source.variants.baseline.stays = [
    { id: "s1", visitId: visit.turnId, rowId: source.rows[0].id, start: arrival.scheduled, end: "2026-10-28T09:20:00Z", arrivalFlightId: arrival.id, towIn: false, towOut: true },
    { id: "s2", visitId: visit.turnId, rowId: source.rows[1].id, start: "2026-10-28T09:30:00Z", end: "2026-10-28T11:00:00Z", towIn: true, towOut: true },
    { id: "s3", visitId: visit.turnId, rowId: source.rows[0].id, start: "2026-10-28T11:10:00Z", end: departure.scheduled, departureFlightId: departure.id, towIn: true, towOut: false },
  ];
  return source;
}

test("tow visits preserve separate stand intervals and source flight endpoints", () => {
  const source = towSnapshot();
  const dataset = adaptPreparedSchedule(source, { airportId: "gtaa", caseId: "full-day" }, "baseline");
  assert.equal(dataset.timeline.occupancies.length, 3);
  assert.equal(dataset.flights.find(flight => flight.direction === "arrival")?.occupancyId, "s1");
  assert.equal(dataset.flights.find(flight => flight.direction === "departure")?.occupancyId, "s3");
  assert.equal(dataset.timeline.endpoints.get("s2")?.start.kind, "tow");
  assert.equal(dataset.timeline.stayPosition.get("s3")?.count, 3);
});

test("tow validation rejects disconnected and overlapping chains", () => {
  const source = towSnapshot();
  source.variants.baseline.stays[1].towIn = false;
  assert.throws(() => adaptPreparedSchedule(source, { airportId: "gtaa", caseId: "full-day" }, "baseline"), /tow chain/);
  const overlap = towSnapshot();
  overlap.variants.baseline.stays[1].start = overlap.variants.baseline.stays[0].end;
  assert.throws(() => adaptPreparedSchedule(overlap, { airportId: "gtaa", caseId: "full-day" }, "baseline"), /tow chain/);
});

test("same-stand overlaps are rejected even when endpoint and coverage metadata are valid", () => {
  const source = snapshot();
  const first = source.variants.baseline.stays[0];
  const other = source.variants.baseline.stays.find(stay => stay.visitId !== first.visitId)!;
  other.rowId = first.rowId;
  other.start = first.start;
  other.end = first.end;
  source.flights.find(flight => flight.id === other.arrivalFlightId)!.scheduled = first.start;
  source.flights.find(flight => flight.id === other.departureFlightId)!.scheduled = first.end;
  assert.throws(() => adaptPreparedSchedule(source, { airportId: "gtaa", caseId: "full-day" }, "baseline"), /Overlapping/);
});
