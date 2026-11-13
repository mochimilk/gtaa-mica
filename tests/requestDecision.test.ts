import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSourceDataset } from "../src/data-sources/registry.ts";
import { parseAccommodation, previewAccommodation } from "../src/overlays/accommodation.ts";
import { buildRequestDecision, requestTurn, utcDate, utcTime } from "../src/requests/requestDecision.ts";

const HOUR = 60 * 60_000;
for (const scenario of ["comfortable", "constrained", "full-day"]) {
  for (const plan of ["baseline", "tow-options"] as const) {
    test(`${scenario}/${plan}: every option shows exact turn timing, both affected stands and all neighboring occupancy`, async () => {
      const source = await loadSourceDataset({ source: "contoso", scenario, plan });
      const original = structuredClone(source);
      const evidence = parseAccommodation(source.overlays!.profiles.accommodation);
      const request = requestTurn(evidence);
      assert.equal(request.arrival.label, evidence.request.visit.arrFlight);
      assert.equal(request.departure.label, evidence.request.visit.depFlight);
      assert.equal(request.arrival.route, evidence.request.visit.origin);
      assert.equal(request.departure.route, evidence.request.visit.destination);
      assert.equal(request.start, Date.parse(evidence.request.start));
      assert.equal(request.end, Date.parse(evidence.request.end));
      assert.equal(request.minutes, (request.end - request.start) / 60_000);
      for (const option of evidence.variants[plan].options) {
        const decision = buildRequestDecision(source, evidence, option.id);
        const proposed = previewAccommodation(source, evidence, option.id).timeline.occupancies;
        assert.equal(decision.incoming.standId, option.target_stand_id);
        assert.equal(decision.moves.length, option.moves.length);
        assert.equal(decision.chart.rows.length, option.moves.length ? 4 : 2);
        const turns = [...decision.moves.map(move => move.after), decision.incoming];
        assert.deepEqual(decision.chart.domain, [
          Math.min(...turns.map(turn => turn.start)) - HOUR,
          Math.max(...turns.map(turn => turn.end)) + HOUR,
        ]);
        for (const move of decision.moves) {
          assert.equal(move.before.start, move.after.start);
          assert.equal(move.before.end, move.after.end);
          assert.notEqual(move.before.standId, move.after.standId);
          assert.deepEqual(move.before.arrival, move.after.arrival);
          assert.deepEqual(move.before.departure, move.after.departure);
        }
        for (const row of decision.chart.rows) {
          const [standId, phase] = JSON.parse(row.id);
          const stays = phase === "Reference" ? source.timeline.occupancies : proposed;
          const expected = stays.filter(stay => stay.rowId === standId &&
            stay.start < decision.chart.domain[1] && stay.end > decision.chart.domain[0]);
          const drawn = decision.chart.occupancies.filter(stay => stay.rowId === row.id);
          assert.equal(drawn.length, expected.length, "do not hide a neighbor and imply that occupied time is free");
          for (const bar of drawn) {
            const detail = decision.chart.bars.get(bar.id)!;
            const actual = expected.find(stay => stay.id === detail.turn.id)!;
            assert.equal(bar.start, actual.start);
            assert.equal(bar.end, actual.end);
            assert.equal(detail.phase, phase);
          }
        }
        for (const item of decision.neighbors) {
          const others = proposed.filter(stay => stay.rowId === item.turn.standId && stay.id !== item.turn.id);
          const earlier = others.filter(stay => stay.end <= item.turn.start);
          const later = others.filter(stay => stay.start >= item.turn.end);
          assert.equal(item.beforeMinutes, earlier.length ? (item.turn.start - Math.max(...earlier.map(stay => stay.end))) / 60_000 : null);
          assert.equal(item.afterMinutes, later.length ? (Math.min(...later.map(stay => stay.start)) - item.turn.end) / 60_000 : null);
          assert.ok(item.beforeMinutes === null || item.beforeMinutes >= 0);
          assert.ok(item.afterMinutes === null || item.afterMinutes >= 0);
        }
        const added = [...decision.chart.bars.values()].filter(bar => bar.kind === "incoming");
        assert.equal(added.length, 1);
        assert.equal(added[0].phase, "With option");
      }
      assert.deepEqual(source, original);
      assert.throws(() => buildRequestDecision(source, evidence, "unknown"), /Unknown/);
    });
  }
}

test("turn times retain full UTC dates across midnight and year boundaries", () => {
  const before = Date.parse("2026-12-31T23:30:00Z"), after = Date.parse("2027-01-01T01:00:00Z");
  assert.equal(utcDate(before), "2026-12-31");
  assert.equal(utcTime(before), "23:30");
  assert.equal(utcDate(after), "2027-01-01");
  assert.equal(utcTime(after), "01:00");
});
