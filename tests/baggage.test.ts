// Baggage reclaim, made from the sample flights: the day's plan has every
// arrival's bags on one of its pier's carousels with no two at once, spread
// over all of them and never on one out of service; each flight's bags are
// counted by its aircraft and come off at the belt's pace; the bags follow
// their flight's times; what a stand change does to them, for the Approvals
// page's carousels: kept on the same pier, moved to the new stand's carousel
// on another, and in the way of whoever is on it then, or of an outage; and
// the day in figures.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { applyPlan, resetStands, setRunningLate } from "../src/operations/allocation.ts";
import { baggageDay, bagMove, describeBagMove, reclaims } from "../src/operations/baggage.ts";
import { utcAt } from "../src/stand-timeline-demo/adapter.ts";
import {
  BAGS_PER_MIN,
  bagsFor,
  CAROUSEL_OUTAGES,
  MIN_RECLAIM_MIN,
  reclaimWindow,
  SYNTHETIC_CAROUSELS,
} from "../src/stand-timeline-demo/baggageFixture.ts";
import { formatUtc } from "../src/stand-timeline-demo/demoData.ts";
import { SYNTHETIC_DATE } from "../src/stand-timeline-demo/syntheticFixture.ts";

afterEach(() => resetStands());

const at = (hhmm: string) => utcAt(SYNTHETIC_DATE, hhmm);
const place = (rowId: string, start: string, end: string) => ({ rowId, start: at(start), end: at(end) });

test("the day's plan puts each arrival's bags on its pier's carousels, never two at once", () => {
  const all = reclaims();
  assert.ok(all.length > 50);
  const areaOf = new Map(SYNTHETIC_CAROUSELS.map((carousel) => [carousel.code, carousel.area]));
  for (const [i, a] of all.entries()) {
    for (const b of all.slice(i + 1)) {
      const clash = a.carousel === b.carousel && a.start < b.end && b.start < a.end;
      assert.ok(!clash, `${a.flight} and ${b.flight} on carousel ${a.carousel}`);
    }
  }
  // XC344, on B11 (Pier B) at 11:50: its first bag 10 minutes later, then its 239 bags at 7 a minute.
  const xc344 = all.find((reclaim) => reclaim.flight === "XC344");
  assert.equal(areaOf.get(xc344?.carousel ?? ""), "Pier B");
  assert.equal(xc344?.bags, 239);
  assert.deepEqual([xc344?.start, xc344?.end], [at("12:00"), at("12:35")]);
  // Never on a carousel while it is out of service.
  for (const reclaim of all) {
    const out = CAROUSEL_OUTAGES.find((outage) => outage.carousel === reclaim.carousel && outage.start < reclaim.end && reclaim.start < outage.end);
    assert.equal(out, undefined, `${reclaim.flight} on carousel ${reclaim.carousel} while it is out`);
  }
});

test("each pier's flights are spread over all its carousels, not piled onto the nearest", () => {
  const all = reclaims();
  for (const carousel of SYNTHETIC_CAROUSELS.filter((entry) => entry.area !== "Remote")) {
    const flights = all.filter((reclaim) => reclaim.carousel === carousel.code).length;
    // Pier A's overflow carousel, with no stands of its own, takes its share too.
    assert.ok(flights >= 7, `carousel ${carousel.code} has ${flights}`);
  }
});

test("a flight's bags are counted by its aircraft, and come off at the belt's pace", () => {
  // The same flight, the same bags every time; a widebody carries more.
  assert.equal(bagsFor("T24", "B789"), bagsFor("T24", "B789"));
  assert.ok(bagsFor("T24", "B789") > 2 * bagsFor("T01", "A320"));
  const onBlock = at("10:00");
  assert.deepEqual(reclaimWindow(onBlock, 281), [at("10:10"), at("10:51")]);
  // However few, the belt runs its minimum.
  assert.deepEqual(reclaimWindow(onBlock, 20), [at("10:10"), at("10:10") + MIN_RECLAIM_MIN * 60_000]);
  assert.equal(BAGS_PER_MIN, 7);
});

test("a late arrival's bags come off late, on the same carousel", () => {
  const before = reclaims().find((reclaim) => reclaim.flight === "XD472");
  setRunningLate("T24-1", 110, 0);
  const after = reclaims().find((reclaim) => reclaim.flight === "XD472");
  assert.equal(after?.carousel, before?.carousel);
  assert.equal(after?.start, at("10:40"));
  // How late, for the ghost back to when they were due off.
  assert.equal(after?.lateMs, 110 * 60_000);
  // Back on time: the plan keeps a delay through Reset stands.
  setRunningLate("T24-1", 0, 0);
});

test("moved to another pier, the bags go to the new stand's carousel and clash with whoever is on it", () => {
  // The disruption's move: XC344/345 from B11 to A3, at the same times.
  const move = bagMove("T25-1", place("B11", "11:50", "12:55"), place("A3", "11:50", "12:55"));
  assert.ok(move);
  assert.equal(move.was?.carousel, "4");
  assert.equal(move.now?.carousel, "1");
  assert.deepEqual(move.clashes.map((clash) => clash.flight), ["XD608"]);
  assert.ok(!move.others.some((other) => other.stayId === "T25-1"));
  assert.equal(
    describeBagMove(move),
    "XC344's 239 bags move from carousel 4 to carousel 1, 12:00–12:35. XD608's are on carousel 1 until 12:15",
  );
});

test("moved onto a carousel out of service, the bags clash with the outage", () => {
  // Carousel 2, A2's, is out for maintenance 12:00–13:30.
  const move = bagMove("T25-1", place("B11", "11:50", "12:55"), place("A2", "11:50", "12:55"));
  assert.ok(move);
  assert.equal(move.now?.carousel, "2");
  assert.deepEqual(move.clashes, []);
  assert.equal(move.outage?.reason, "Belt maintenance");
  assert.equal(
    describeBagMove(move),
    "XC344's 239 bags move from carousel 4 to carousel 2, 12:00–12:35. Carousel 2 is out for belt maintenance 12:00–13:30",
  );
});

test("moved on the same pier, the bags keep their carousel; retimed, they follow", () => {
  const same = bagMove("T26-1", place("B11", "13:05", "13:45"), place("B10", "13:05", "13:45"));
  assert.equal(same?.now?.carousel, same?.was?.carousel);
  assert.equal(describeBagMove(same!), "XB232's 146 bags stay on carousel 5, 13:15–13:36");
  const later = bagMove("T26-1", place("B11", "13:05", "13:45"), place("B11", "13:35", "14:15"));
  assert.equal(describeBagMove(later!).split(".")[0], "XB232's 146 bags stay on carousel 5, now 13:45–14:06");
});

test("bags only for a stay that starts with its arrival, and none off a stand", () => {
  // XA113/114 reaches B14 by tow from R2: no bags to reclaim there.
  assert.equal(bagMove("T21-2", place("B14", "09:10", "11:30"), place("B10", "09:10", "11:30")), null);
  const off = bagMove("T01-1", place("A1", "04:10", "06:05"), place("", "04:10", "06:05"));
  assert.equal(off?.now, undefined);
  assert.equal(describeBagMove(off!), "XA101's 119 bags no longer come off carousel 1");
  applyPlan({ kind: "move", occupancyId: "T01-1", standId: "C25" });
  assert.equal(reclaims().find((reclaim) => reclaim.stayId === "T01-1")?.carousel, "8");
});

test("the day on the carousels, in figures: flights, bags, the busiest hour, outages and clashes", () => {
  const day = baggageDay();
  assert.equal(day.flights, 96);
  assert.equal(day.bags, 14862);
  assert.equal(day.peak && `${formatUtc(day.peak.from)} · ${day.peak.flights}`, "06:00 · 15");
  assert.equal(day.outages, 3);
  // The plan has none; a late arrival's bags coming off late land on someone else's.
  assert.equal(day.clashes, 0);
  setRunningLate("T24-1", 110, 0);
  assert.equal(baggageDay().clashes, 2);
  setRunningLate("T24-1", 0, 0);
});
