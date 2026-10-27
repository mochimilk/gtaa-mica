// Giving stands to flights that have none, taking them away, and the live
// alerts that follow: flights with no stand and conflicts from late stays.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { applyAppAction, validateAppAction, type AppAction } from "../src/live/appActions.ts";
import { decisionToRequest } from "../src/live/backendInterpreter.ts";
import { injectionByteLength, MAX_INJECTION_BYTES } from "../src/live/liveEvents.ts";
import { describeSnapshot } from "../src/live/opsHost.ts";
import { phraseInterpreter } from "../src/live/requestInterpreter.ts";
import {
  applyAssigns,
  applyPlan,
  hasStandChanges,
  occupancyById,
  offBoardStay,
  planAssign,
  resetStands,
  setClosure,
  unassignStays,
} from "../src/operations/allocation.ts";
import { currentAlerts } from "../src/operations/boardAlerts.ts";
import { OPS_FLIGHTS, OPS_FLIGHTS_BY_ID } from "../src/operations/operationsData.ts";
import { DEMO_DATA, DEMO_DOMAIN } from "../src/stand-timeline-demo/demoData.ts";
import { createFakeHost } from "./support/mocks.ts";

afterEach(() => resetStands());

const alertIds = () => currentAlerts().map((alert) => alert.id);
const standOf = (flightId: string) => OPS_FLIGHTS_BY_ID.get(flightId)?.standId;

function run(name: string, args: Record<string, unknown> = {}, host = createFakeHost()) {
  const validated = validateAppAction(name, args);
  assert.ok(validated.ok, validated.ok ? "" : validated.message);
  const result = applyAppAction(validated.action, host);
  assert.ok(result.ok, result.ok ? "" : result.message);
  return { action: validated.action, spoken: result.spoken, mutated: result.mutated, host };
}

async function interpret(utterance: string) {
  const host = createFakeHost();
  return phraseInterpreter.interpret({ utterance, snapshot: host.snapshot(), transcript: "", taskHistory: [] });
}

/* ------------------------------------------------------------- planning */

test("each no-stand flight with stay times gets the first free stand that takes it", () => {
  const plan = planAssign(["U01-1", "U02-1", "U03-1", "U04-1"]);
  assert.deepEqual(plan.assigns, [
    // XB240, a B738: narrowbody-only stands first, so wide ones stay free.
    { stayId: "U01-1", standId: "C27" },
    // XA130 has no aircraft type, so it only goes where any aircraft fits.
    { stayId: "U02-1", standId: "A3" },
    // XD480, a B789.
    { stayId: "U03-1", standId: "B10" },
    // XC350 overlaps XB240, which was planned onto C27 first.
    { stayId: "U04-1", standId: "D44" },
  ]);
  assert.deepEqual(plan.unplaceable, []);
});

test("a named stand is checked against the sample rules, with a reason that names the flight", () => {
  // No aircraft type recorded: treated as a widebody.
  assert.match(planAssign(["U02-1"], "A1").unplaceable[0].reason, /XA130 has no aircraft type recorded.*A1 is narrowbody only/);
  assert.match(planAssign(["U03-1"], "A1").unplaceable[0].reason, /XD480 is a B789, a widebody/);
  // XB240 09:45–11:10 onto A1, where XB210/211 is 09:00–10:15.
  assert.match(planAssign(["U01-1"], "A1").unplaceable[0].reason, /XB240 would overlap XB210\/211 on A1/);
  // A stay already on the chart is not assigned again.
  assert.match(planAssign(["T01-1"]).unplaceable[0].reason, /already on A1/);
});

test("a closed area is avoided, and refused when named", () => {
  setClosure({ area: "Pier C", from: DEMO_DOMAIN[0], to: DEMO_DOMAIN[1] });
  assert.deepEqual(planAssign(["U01-1"]).assigns, [{ stayId: "U01-1", standId: "D44" }]);
  assert.match(planAssign(["U01-1"], "C27").unplaceable[0].reason, /C27 is closed/);
});

test("with no stand free, the reason says when and what kind of stand", () => {
  // Fill every stand that takes any aircraft over XA130's window.
  const window = offBoardStay("U02-1");
  assert.ok(window);
  for (const stand of ["A2", "A3", "A5", "A6", "B10", "B11", "B12", "B15", "B16", "C20", "C21", "C22", "C23", "C24", "C25", "C26", "D40", "D41", "D42", "D43", "R1", "R2", "R3", "R4"]) {
    DEMO_DATA.occupancies.push({ id: `FILL-${stand}`, rowId: stand, start: window.start, end: window.end });
  }
  try {
    assert.match(
      planAssign(["U02-1"]).unplaceable[0].reason,
      /XA130 has no aircraft type recorded, and no stand that takes any aircraft is free 11:20–12:35 UTC/,
    );
  } finally {
    DEMO_DATA.occupancies.splice(DEMO_DATA.occupancies.findIndex((o) => o.id.startsWith("FILL-")));
  }
});

/* --------------------------------------------------- applying and reset */

test("giving stands puts the stays on the chart, clears their alerts, and reset takes them off again", () => {
  assert.ok(alertIds().includes("ALERT-U01"));
  const before = DEMO_DATA.occupancies.length;

  assert.deepEqual(applyAssigns(planAssign(["U01-1", "U03-1"]).assigns), ["U01-1", "U03-1"]);
  assert.equal(standOf("U01"), "C27");
  assert.equal(OPS_FLIGHTS_BY_ID.get("U01")?.unplacedStay, undefined);
  assert.equal(occupancyById("U01-1")?.rowId, "C27");
  assert.equal(DEMO_DATA.occupancies.length, before + 2);
  assert.equal(alertIds().includes("ALERT-U01"), false);
  assert.equal(hasStandChanges(), true);

  resetStands();
  assert.equal(standOf("U01"), undefined);
  assert.equal(OPS_FLIGHTS_BY_ID.get("U01")?.unplacedStay?.stayId, "U01-1");
  assert.equal(occupancyById("U01-1"), undefined);
  assert.equal(DEMO_DATA.occupancies.length, before);
  assert.ok(alertIds().includes("ALERT-U01"));
  assert.equal(hasStandChanges(), false);
});

test("taking a stay off its stand leaves both its flights waiting for one, and clears the conflict it was in", () => {
  assert.ok(alertIds().includes("ALERT-CLASH-T02-1-end"));
  // XB210/211 on A1 is what XA103/104's late departure runs into.
  assert.deepEqual(unassignStays(["T03-1"]), ["T03-1"]);
  for (const id of ["T03-ARR", "T03-DEP"]) {
    const flight = OPS_FLIGHTS_BY_ID.get(id);
    assert.equal(flight?.standId, undefined);
    assert.equal(flight?.unplacedStay?.stayId, "T03-1");
    assert.ok(alertIds().includes(`ALERT-${id}`));
  }
  assert.equal(alertIds().includes("ALERT-CLASH-T02-1-end"), false);

  // It can be given a stand again, keeping its times.
  assert.deepEqual(applyAssigns([{ stayId: "T03-1", standId: "C25" }]), ["T03-1"]);
  assert.equal(standOf("T03-DEP"), "C25");

  resetStands();
  assert.equal(standOf("T03-ARR"), "A1");
  assert.equal(hasStandChanges(), false);
});

/* ---------------------------------------------------------- Skye's actions */

test("'fix the no-stand flights' places what fits and says why the rest can't be placed", () => {
  const { action, spoken, mutated, host } = run("assign_stands", { flightIds: null });
  assert.equal(action.name, "assign_stands");
  assert.deepEqual((action as Extract<AppAction, { name: "assign_stands" }>).flightIds, ["U01", "U02", "U03", "U04", "U05"]);
  assert.equal(mutated, true);
  // Placed; the next thing offered (the A1 conflict) is selected only as Skye says it.
  assert.deepEqual(host.calls, ["assignStands:U01-1>C27|U02-1>A3|U03-1>B10|U04-1>D44"]);
  assert.match(spoken, /^Placed XB240 on C27, XA130 on A3, XD480 on B10 and XC350 on D44\./);
  assert.match(spoken, /I couldn't place one: XB241 has no stay times in the demo data/);
  assert.match(spoken, /checked only for overlaps, stand sizes and closures/);
  // Having cleared what it could, Skye offers the next thing to do.
  assert.match(spoken, /Next up: the A1 conflict/);
  assert.ok(injectionByteLength(spoken) <= MAX_INJECTION_BYTES);

  // Carried out again (Skye's drags already placed them): nothing is placed
  // twice, and the same result is shown and said.
  const onChart = DEMO_DATA.occupancies.length;
  const again = applyAppAction(action, host);
  assert.ok(again.ok);
  assert.equal(DEMO_DATA.occupancies.length, onChart);
  assert.equal(host.calls[1], host.calls[0]);
  assert.equal(again.spoken.split(" Next up")[0], spoken.split(" Next up")[0]);
});

test("a flight already on a stand is pointed at a move, and a named stand needs exactly one flight", () => {
  const { spoken, mutated } = run("assign_stands", { flightIds: ["T01-ARR"] });
  assert.equal(mutated, false);
  assert.match(spoken, /XA101 is already on A1; I can move it instead/);

  assert.equal(validateAppAction("assign_stands", { flightIds: ["U01", "U04"], standId: "C25" }).ok, false);
  assert.equal(validateAppAction("assign_stands", { flightIds: ["U01"], standId: "Z9" }).ok, false);
  assert.equal(validateAppAction("assign_stands", { flightIds: ["NOPE"] }).ok, false);

  const named = run("assign_stands", { flightIds: ["U01"], standId: "c25" });
  assert.match(named.spoken, /^Placed XB240 on C25\./);
});

test("with many to place, the placed flights are counted so every reason still fits", () => {
  // Take twelve stays off their stands, so there is a lot to say.
  unassignStays(DEMO_DATA.occupancies.filter((o) => o.id.startsWith("G")).slice(0, 12).map((o) => o.id));
  const { spoken } = run("assign_stands");
  assert.ok(injectionByteLength(spoken) <= MAX_INJECTION_BYTES, `${injectionByteLength(spoken)} bytes`);
  assert.match(spoken, /XB241 has no stay times/);
});

test("unassigning takes the whole stay off, and says so", () => {
  const { spoken, host } = run("unassign_stands", { flightIds: ["T01-ARR", "T01-DEP", "U01"] });
  assert.deepEqual(host.calls, ["unassignStands:T01-1"]);
  assert.match(spoken, /^Took XA101\/102 off A1\. It has no stand now, so it's waiting in the No stand row\./);
  assert.match(spoken, /XB240 already had no stand/);
  assert.match(spoken, /Reset stands puts it back/);

  const none = validateAppAction("unassign_stands", { flightIds: ["U01"] });
  assert.ok(!none.ok);
  assert.match(none.ok ? "" : none.message, /XB240 has no stand already/);
  assert.equal(validateAppAction("unassign_stands", {}).ok, false);
});

test("every open alert is read, grouped, and conflicts can be read on their own", () => {
  const alerts = run("list_alerts").spoken;
  assert.match(alerts, /^9 open demo alerts\./);
  assert.match(alerts, /5 flights have no stand: XB240, XC350, XA130, XD480 and XB241\./);
  assert.match(alerts, /2 conflicts: XA103\/104 runs 55m late off A1, into XB210\/211; XA107\/108 runs 1h 00m late onto A4, over XB214\/215\./);
  assert.match(alerts, /2 notices/);

  const conflicts = run("list_conflicts").spoken;
  assert.match(conflicts, /^2 conflicts, from late stays: XA103\/104 .* A1.*; XA107\/108 .* A4/);

  // Moving XB210/211 off A1 clears that conflict.
  applyPlan({ kind: "move", occupancyId: "T03-1", standId: "C25" });
  assert.match(run("list_conflicts").spoken, /^One conflict, from late stays: XA107\/108/);
});

test("acknowledging an alert that has cleared says so instead of pretending", () => {
  const ack = validateAppAction("acknowledge_alert", { alertId: "ALERT-U01" });
  assert.ok(ack.ok);
  applyAssigns(planAssign(["U01-1"]).assigns);
  const result = applyAppAction(ack.action, createFakeHost());
  assert.ok(!result.ok);
  assert.match(result.ok ? "" : result.message, /has cleared/);
  assert.equal(validateAppAction("acknowledge_alert", { alertId: "ALERT-U01" }).ok, false);
});

/* ------------------------------------------------------------ interpreters */

test("phrase requests map onto giving, moving and taking away stands, and conflicts", async () => {
  const actionFor = async (utterance: string): Promise<AppAction> => {
    const result = await interpret(utterance);
    assert.equal(result.kind, "action", `${utterance}: ${JSON.stringify(result)}`);
    return (result as { action: AppAction }).action;
  };
  const all = await actionFor("give the no-stand flights stands");
  assert.equal(all.name === "assign_stands" && all.flightIds.length, 5);
  const put = await actionFor("put XB240 on C25");
  assert.equal(put.name === "assign_stands" && put.standId, "C25");
  assert.equal((await actionFor("assign XA101 to C25")).name, "move_stay");
  const off = await actionFor("unassign XA101");
  assert.deepEqual(off.name === "unassign_stands" && off.stays, [{ stayId: "T01-1", standId: "A1" }]);
  assert.equal((await actionFor("take XB210 off its stand")).name, "unassign_stands");
  assert.equal((await actionFor("are there any conflicts")).name, "list_conflicts");
  assert.equal((await actionFor("go over the alerts and any conflicts")).name, "brief");
  assert.equal((await actionFor("read me every alert")).name, "list_alerts");
});

test("a model decision with no flights gives stands to every flight that has none", () => {
  const all = decisionToRequest({ kind: "action", action_name: "assign_stands", args: { flightIds: null, standId: null } });
  assert.equal(all.kind, "action");
  const action = all.kind === "action" ? all.action : null;
  assert.deepEqual(
    action?.name === "assign_stands" && action.flightIds,
    OPS_FLIGHTS.filter((flight) => !flight.standId).map((flight) => flight.id),
  );
  // A lone flightId is read as that one flight.
  const one = decisionToRequest({ kind: "action", action_name: "unassign_stands", args: { flightId: "T01-ARR", flightIds: null } });
  assert.equal(one.kind === "action" && one.action.name, "unassign_stands");
});

test("asking which flights have no stand finds them, however it is put", async () => {
  for (const query of ["unassigned", "no stand", "flights without a stand", "unassigned flights"]) {
    const { spoken } = run("find_flights", { query });
    assert.match(spoken, /^5 flights have no stand: XB240 09:45–11:10; XC350 09:10–10:30; XA130 11:20–12:35; XD480 14:05–16:50; XB241, no stay times yet\./, query);
  }
  for (const utterance of ["are there any unassigned flights", "which flights don't have a stand", "any flights without a stand?"]) {
    const result = await interpret(utterance);
    assert.equal(result.kind === "action" && result.action.name, "find_flights", utterance);
  }
  // A filter request still filters.
  const filter = await interpret("only show unassigned flights");
  assert.equal(filter.kind === "action" && filter.action.name, "set_filter");

  // A flight taken off its stand is found too, and none are once all have one.
  unassignStays(["T03-1"]);
  assert.match(run("find_flights", { query: "no stand" }).spoken, /^7 flights have no stand/);
});

test("Skye's quiet board context names the flights with no stand", () => {
  const context = describeSnapshot(createFakeHost().snapshot());
  assert.match(context, /No stand: XB240, XA130, XD480, XC350, XB241\./);
});
