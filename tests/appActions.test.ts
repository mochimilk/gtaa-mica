// The action allowlist: validation against the real fixture, and application.
import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_KIND, APP_ACTION_NAMES, applyAppAction, isAppActionName, validateAppAction } from "../src/live/appActions.ts";
import { createFakeHost } from "./support/mocks.ts";

test("only allowlisted names are actions, including inherited ones", () => {
  // `"constructor" in ACTION_KIND` is true via Object.prototype; membership
  // must not be tested that way or the switch falls through to undefined.
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(isAppActionName(name), false, `${name} must not be an action`);
    const result = validateAppAction(name, {});
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "unknown_action");
  }

  for (const name of [undefined, null, 42, {}, [], "", "  ", "select_everything"]) {
    assert.equal(validateAppAction(name, {}).ok, false);
  }

  for (const name of APP_ACTION_NAMES) assert.equal(isAppActionName(name), true);
});

test("malformed argument objects are tolerated, never trusted", () => {
  for (const args of [null, undefined, "nope", 7, []] as unknown[]) {
    const result = validateAppAction("select_flight", args as Record<string, unknown>);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "invalid_arguments");
  }
  // A prototype-polluted payload cannot smuggle an id through.
  const polluted = JSON.parse('{"__proto__":{"flightId":"T01-ARR"}}') as Record<string, unknown>;
  assert.equal(validateAppAction("select_flight", polluted).ok, false);
});

test("identifiers are checked against the fixture", () => {
  assert.equal(validateAppAction("select_flight", { flightId: "T01-ARR" }).ok, true);
  assert.equal(validateAppAction("select_flight", { flightId: "NOPE-1" }).ok, false);
  assert.equal(validateAppAction("acknowledge_alert", { alertId: "ALERT-U01" }).ok, true);
  assert.equal(validateAppAction("acknowledge_alert", { alertId: "ALERT-NOPE" }).ok, false);
  assert.equal(validateAppAction("set_view", { view: "attention" }).ok, true);
  assert.equal(validateAppAction("set_view", { view: "everything" }).ok, false);

  const filter = validateAppAction("set_filter", { dimension: "carrier", values: ["xa", "XA", "XB"] });
  assert.ok(filter.ok);
  // Case-insensitively matched onto the fixture spelling, and deduplicated.
  assert.deepEqual(filter.action, { name: "set_filter", dimension: "carrier", values: ["XA", "XB"] });

  assert.equal(validateAppAction("set_filter", { dimension: "carrier", values: ["ZZ"] }).ok, false);
  assert.equal(validateAppAction("set_filter", { dimension: "airline", values: [] }).ok, false);
  assert.equal(validateAppAction("set_filter", { dimension: "carrier", values: "XA" }).ok, false);
  assert.equal(
    validateAppAction("set_filter", { dimension: "carrier", values: new Array(13).fill("XA") }).ok,
    false,
  );
  // An empty list is the documented way to clear a dimension.
  assert.equal(validateAppAction("set_filter", { dimension: "area", values: [] }).ok, true);
});

test("applying actions goes through the operations host", () => {
  const host = createFakeHost();

  const select = validateAppAction("select_flight", { flightId: "T01-ARR" });
  assert.ok(select.ok);
  const selected = applyAppAction(select.action, host);
  assert.ok(selected.ok && selected.mutated);
  assert.ok(selected.ok && selected.spoken.includes("XA101"));
  assert.deepEqual(host.calls, ["selectFlight:T01-ARR"]);

  const view = validateAppAction("set_view", { view: "arrivals" });
  assert.ok(view.ok);
  const viewed = applyAppAction(view.action, host);
  assert.ok(viewed.ok && viewed.spoken.includes("Arrivals"));
  assert.equal(host.calls.at(-1), "setView:arrivals");

  const ack = validateAppAction("acknowledge_alert", { alertId: "ALERT-U01" });
  assert.ok(ack.ok);
  assert.ok(applyAppAction(ack.action, host).ok);
  assert.equal(host.calls.at(-1), "setAcknowledged:ALERT-U01:true");
});

test("an unassigned flight is described as having no stand", () => {
  const host = createFakeHost();
  const action = validateAppAction("select_flight", { flightId: "U01" });
  assert.ok(action.ok);
  const result = applyAppAction(action.action, host);
  assert.ok(result.ok);
  assert.ok(result.spoken.includes("no stand"));
});

test("read actions do not mutate the board", () => {
  const host = createFakeHost({ selection: { occupancyIds: [], flightId: "T01-ARR" } });
  const action = validateAppAction("describe_selection", {});
  assert.ok(action.ok);
  const result = applyAppAction(action.action, host);
  assert.ok(result.ok);
  assert.equal(result.mutated, false);
  const search = validateAppAction("find_flights", { query: "XA101" });
  assert.ok(search.ok);
  const found = applyAppAction(search.action, host);
  assert.ok(found.ok && found.spoken.includes("XA101"));
  assert.equal(host.calls.length, 0);
  // Reading the alerts selects nothing by itself: each alert is selected
  // only as Skye says it (its cues; see the executor).
  const alerts = validateAppAction("list_alerts", {});
  assert.ok(alerts.ok);
  const read = applyAppAction(alerts.action, host);
  assert.deepEqual(host.calls, []);
  assert.ok(read.ok && read.cues && read.cues.length > 0);
  read.cues[0].show();
  // Its stays selected, and the alert picked out in Skye's compact alerts.
  assert.deepEqual(host.calls, ["selectFlights:replace:T02-ARR|T03-ARR", "showAlerts:ALERT-CLASH-T02-1-end"]);
});

test("find_flights reports no match plainly", () => {
  const action = validateAppAction("find_flights", { query: "ZZ999" });
  assert.ok(action.ok);
  const result = applyAppAction(action.action, createFakeHost());
  assert.ok(result.ok);
  assert.ok(result.spoken.startsWith("No flight"));
});

test("giving and taking away stands are writes, and reading conflicts is a read", () => {
  // Assigning used to be refused outright; see standAssignment.test.ts.
  assert.equal(ACTION_KIND.assign_stands, "write");
  assert.equal(ACTION_KIND.unassign_stands, "write");
  assert.equal(ACTION_KIND.list_conflicts, "read");
  assert.equal(isAppActionName("assign_stand"), false);
});

test("a chart selection is described by flight, not just counted", () => {
  const host = createFakeHost({ selection: { occupancyIds: ["T01-1"], flightId: null } });
  const action = validateAppAction("describe_selection", {});
  assert.ok(action.ok);
  const result = applyAppAction(action.action, host);
  assert.ok(result.ok);
  // Both endpoints of the stay are named.
  assert.ok(result.spoken.includes("XA101"));
  assert.ok(result.spoken.includes("XA102"));
});

test("selecting a flight on a stand says how long it holds it", () => {
  const host = createFakeHost();
  const result = applyAppAction({ name: "select_flight", flightId: "T21-ARR" }, host);
  assert.ok(result.ok);
  assert.match(result.ok ? result.spoken : "", /XA113, arrival on stand R2, which it holds for 10h 10m\./);
});

test("select_flights checks every id, drops repeats, and starts a new selection by default", () => {
  const result = validateAppAction("select_flights", { flightIds: ["T01-ARR", "T03-ARR", "T01-ARR"] });
  assert.deepEqual(result.ok && result.action, {
    name: "select_flights",
    flightIds: ["T01-ARR", "T03-ARR"],
    mode: "replace",
  });
  assert.equal(validateAppAction("select_flights", { flightIds: ["T01-ARR"], mode: "add" }).ok, true);

  for (const args of [{}, { flightIds: [] }, { flightIds: "T01-ARR" }, { flightIds: ["T01-ARR"], mode: "toggle" }]) {
    const bad = validateAppAction("select_flights", args);
    assert.equal(bad.ok === false && bad.code, "invalid_arguments", JSON.stringify(args));
  }
  const ghost = validateAppAction("select_flights", { flightIds: ["T01-ARR", "GHOST-1"] });
  assert.equal(ghost.ok === false && ghost.code, "unknown_flight");
  const tooMany = validateAppAction("select_flights", { flightIds: Array(13).fill("T01-ARR") });
  assert.equal(tooMany.ok, false);
});

test("several flights are selected together on the chart, or added to the selection", () => {
  const host = createFakeHost();

  const both = applyAppAction({ name: "select_flights", flightIds: ["T01-ARR", "T03-ARR"], mode: "replace" }, host);
  assert.ok(both.ok && both.mutated);
  assert.equal(both.ok && both.spoken, "Selected XA101 and XB210.");
  assert.deepEqual(host.snapshot().selection.occupancyIds, ["T01-1", "T03-1"]);

  const more = applyAppAction({ name: "select_flights", flightIds: ["T05-ARR"], mode: "add" }, host);
  assert.equal(more.ok && more.spoken, "Added XB212, 3 stays selected in all.");
  assert.deepEqual(host.snapshot().selection.occupancyIds, ["T01-1", "T03-1", "T05-1"]);
  assert.deepEqual(host.calls, ["selectFlights:replace:T01-ARR|T03-ARR", "selectFlights:add:T05-ARR"]);

  // One flight in place of the selection is an ordinary selection.
  applyAppAction({ name: "select_flights", flightIds: ["T01-ARR"], mode: "replace" }, host);
  assert.equal(host.calls.at(-1), "selectFlight:T01-ARR");
});

test("a flight with no stand cannot join a chart selection, and says so", () => {
  const host = createFakeHost();

  const mixed = applyAppAction({ name: "select_flights", flightIds: ["T01-ARR", "U01"], mode: "replace" }, host);
  assert.ok(mixed.ok);
  assert.match(mixed.ok ? mixed.spoken : "", /^Selected XA101\. XB240 has no stand, so it was left out\.$/);
  assert.deepEqual(host.calls, ["selectFlights:replace:T01-ARR"]);

  const none = applyAppAction({ name: "select_flights", flightIds: ["U01", "U02"], mode: "replace" }, host);
  assert.equal(none.ok === false && none.code, "not_on_chart");
  assert.equal(host.calls.length, 1);
});
