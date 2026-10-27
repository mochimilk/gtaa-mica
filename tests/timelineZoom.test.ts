// The chart's time-axis zoom (stand-timeline/zoom.ts): its bounds, how it
// stays fitted as the chart resizes, and when it asks the chart to hold the
// time under the pointer in place.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HOUR } from "../src/stand-timeline/geometry.ts";
import { createZoomLink, zoomControls, zoomView } from "../src/stand-timeline/zoom.ts";

const MAX = 960;

/** A zoom laid out like a 12-hour board 1200px wide (fit: 100px/h), with the chart's holds recorded. */
function board(initialHourWidth = 168) {
  const link = createZoomLink(initialHourWidth);
  const holds: (number | undefined)[] = [];
  link.attach((clientX) => holds.push(clientX));
  link.layout(1200, 100);
  const view = () => zoomView(link.get(), MAX);
  return { link, holds, view, ...zoomControls(link, MAX) };
}

test("before the chart is laid out, the zoom draws what was asked for and shows no span", () => {
  const view = zoomView(createZoomLink(168).get(), MAX);
  assert.equal(view.hourWidth, 168);
  assert.equal(view.fitHourWidth, 0);
  assert.equal(view.fitted, false);
  assert.equal(view.visibleMs, 0);
});

test("the zoom starts where it was asked to, and says how much time the board shows", () => {
  const { view } = board();
  assert.equal(view().hourWidth, 168);
  assert.equal(view().fitted, false);
  assert.equal(view().visibleMs, (1200 / 168) * HOUR);
});

test("zooming in and out stays between the fit and the max", () => {
  const z = board();
  z.zoomTo(5000);
  assert.equal(z.view().hourWidth, MAX);
  z.zoomBy(1 / 100);
  assert.equal(z.view().hourWidth, 100);
  assert.equal(z.view().fitted, true);
  assert.equal(z.view().visibleMs, 12 * HOUR);
});

test("zoomed all the way out, the whole window stays fitted as the chart resizes", () => {
  const z = board();
  z.fit();
  z.link.layout(1500, 125);
  assert.equal(z.view().hourWidth, 125);
  assert.equal(z.view().fitted, true);
  z.link.layout(900, 75);
  assert.equal(z.view().hourWidth, 75);
  // A slider dragged to its low end (the fit) is fitted too.
  z.zoomTo(300);
  z.zoomTo(75);
  z.link.layout(1500, 125);
  assert.equal(z.view().hourWidth, 125);
});

test("zooming in from fitted builds on the fit, and zooms before a render compound", () => {
  const z = board();
  z.fit();
  z.zoomBy(2);
  assert.equal(z.view().hourWidth, 200);
  z.zoomBy(1.5);
  z.zoomBy(1.5);
  assert.equal(z.view().hourWidth, 450);
});

test("each zoom asks the chart to hold the time at its centre, and a zoom that changes nothing does not", () => {
  const z = board();
  z.zoomBy(2, 640);
  z.zoomTo(400);
  assert.deepEqual(z.holds, [640, undefined]);
  z.zoomTo(MAX);
  z.zoomTo(MAX + 100);
  z.fit();
  z.fit();
  assert.equal(z.holds.length, 4);
});

test("a chart laid out wider than its window needs is drawn fitted, whatever was asked for", () => {
  const z = board();
  z.link.layout(3000, 250);
  assert.equal(z.view().hourWidth, 250);
  assert.equal(z.view().fitted, true);
  // Narrowed again, it goes back to what was asked for.
  z.link.layout(1200, 100);
  assert.equal(z.view().hourWidth, 168);
});
