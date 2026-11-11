// Delegation execution: duplicates, supersession, cancellation, staleness.
import assert from "node:assert/strict";
import test from "node:test";
import { DelegationExecutor, type ExecutorLogEntry } from "../src/live/executor.ts";
import type { InjectionKind, LiveDelegationCreated } from "../src/live/liveEvents.ts";
import {
  phraseInterpreter,
  type InterpretationRequest,
  type InterpretedRequest,
  type RequestInterpreter,
} from "../src/live/requestInterpreter.ts";
import { TranscriptLog } from "../src/live/transcript.ts";
import { createFakeHost, createScheduler, flush, type FakeHost } from "./support/mocks.ts";
import { setRunningLate } from "../src/operations/allocation.ts";
import { landDisruption } from "../src/operations/disruption.ts";

// The plan starts clear; the day's news makes two conflicts. XA103/104 runs
// 55 minutes late off A1, into XB210/211; and the disruption: XD472/473 is
// 1h 50m late onto B11 and 3h 10m late off it, and runs into the four
// arrivals behind it.
setRunningLate("T02-1", 0, 55);
landDisruption();

const SETTLE_MS = 400;

type Injection = { kind: InjectionKind; delegationId: string | null; content: string };

type Setup = {
  executor: DelegationExecutor;
  host: FakeHost;
  transcript: TranscriptLog;
  injections: Injection[];
  logs: ExecutorLogEntry[];
  busy: boolean[];
  scheduler: ReturnType<typeof createScheduler>;
  /** Runs the settle timer and lets the async run complete. */
  settle: () => Promise<void>;
};

function setup(options: { interpreter?: RequestInterpreter; host?: FakeHost } = {}): Setup {
  const scheduler = createScheduler();
  const host = options.host ?? createFakeHost();
  const transcript = new TranscriptLog();
  const injections: Injection[] = [];
  const logs: ExecutorLogEntry[] = [];
  const busy: boolean[] = [];

  const executor = new DelegationExecutor({
    host,
    transcript,
    interpreter: options.interpreter ?? phraseInterpreter,
    settleMs: SETTLE_MS,
    contextSyncMs: 1_200,
    schedule: scheduler.schedule,
    inject: (kind, delegationId, content) => injections.push({ kind, delegationId, content }),
    onLog: (entry) => logs.push(entry),
    onBusyChange: (value) => busy.push(value),
  });

  return {
    executor,
    host,
    transcript,
    injections,
    logs,
    busy,
    scheduler,
    async settle() {
      scheduler.advance(SETTLE_MS);
      await flush();
    },
  };
}

const delegation = (id: string, offsetMs = 1_000): LiveDelegationCreated => ({
  type: "session.delegation.created",
  delegationId: id,
  target: "client",
  offsetMs,
});

const spoken = (injections: Injection[]) => injections.filter((entry) => entry.kind === "commentary");

/** An interpreter whose answer is resolved by the test. */
function deferredInterpreter() {
  let resolve: ((value: InterpretedRequest) => void) | null = null;
  let request: InterpretationRequest | null = null;
  let signal: AbortSignal | undefined;
  let calls = 0;

  const interpreter: RequestInterpreter = {
    id: "deferred",
    interpret(next, nextSignal) {
      calls += 1;
      request = next;
      signal = nextSignal;
      return new Promise<InterpretedRequest>((resolveNext) => {
        resolve = resolveNext;
      });
    },
  };

  return {
    interpreter,
    answer(value: InterpretedRequest) {
      resolve?.(value);
    },
    get request() {
      return request;
    },
    get signal() {
      return signal;
    },
    get calls() {
      return calls;
    },
  };
}

test("a client delegation is reconstructed from the transcript and applied", async () => {
  const s = setup();
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));

  // Quiet progress first, carrying the delegation id, and nothing spoken yet.
  assert.equal(s.injections[0].kind, "thinking");
  assert.equal(s.injections[0].delegationId, "item_1");
  assert.equal(spoken(s.injections).length, 0);
  assert.deepEqual(s.busy, [true]);

  await s.settle();

  assert.deepEqual(s.host.calls, ["selectFlight:T01-ARR"]);
  const said = spoken(s.injections);
  assert.equal(said.length, 1);
  assert.equal(said[0].delegationId, "item_1");
  assert.match(said[0].content, /XA101/);
  assert.deepEqual(s.busy, [true, false]);
  assert.equal(s.executor.busy, false);
});

test("several flights named together are selected together, in the order said", async () => {
  const s = setup();
  s.transcript.append("user", "select XB210 and XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();
  assert.deepEqual(s.host.calls, ["selectFlights:replace:T03-ARR|T01-ARR"]);
});

test("asking to also select a flight adds it to the selection", async () => {
  const s = setup();
  s.transcript.append("user", "also select XB212", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();
  assert.deepEqual(s.host.calls, ["selectFlights:add:T05-ARR"]);
});

test("responses-delegated work is left to the API", async () => {
  const s = setup();
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation({ ...delegation("item_1"), target: "responses" });

  await s.settle();
  // Running it here too would be the double-execution the guides warn about.
  assert.deepEqual(s.host.calls, []);
  assert.deepEqual(s.injections, []);
  assert.equal(s.logs[0].outcome, "ignored_target");
});

test("a repeated delegation id runs once", async () => {
  const s = setup();
  s.transcript.append("user", "select XA101", 600, 1_000);

  s.executor.handleDelegation(delegation("item_1"));
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  assert.deepEqual(s.host.calls, ["selectFlight:T01-ARR"]);
  assert.equal(spoken(s.injections).length, 1);
  assert.ok(s.logs.some((entry) => entry.outcome === "duplicate"));
  assert.deepEqual(s.executor.handledDelegationIds, ["item_1"]);
});

test("a newer request supersedes the one in flight", async () => {
  const s = setup();
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1", 1_000));

  // The agent starts answering, then the user asks for something else before
  // the first request has settled.
  s.transcript.append("agent", "Selecting it now.", 1_100, 1_400);
  s.transcript.append("user", "clear the selection", 1_500, 2_000);
  s.executor.handleDelegation(delegation("item_2", 2_100));
  await s.settle();

  // Only the newer request reached the app.
  assert.deepEqual(s.host.calls, ["clearSelection"]);
  assert.ok(s.logs.some((entry) => entry.outcome === "superseded" && entry.delegationId === "item_1"));
  const said = spoken(s.injections);
  assert.equal(said.length, 1);
  assert.equal(said[0].delegationId, "item_2");
});

test("cancelling before the settle keeps the request out of the app", async () => {
  const s = setup();
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));

  s.executor.cancelAll("call ended");
  await s.settle();

  assert.deepEqual(s.host.calls, []);
  assert.equal(spoken(s.injections).length, 0);
  assert.equal(s.executor.busy, false);
});

test("a result arriving after cancellation is rejected, and the request aborted", async () => {
  const deferred = deferredInterpreter();
  const s = setup({ interpreter: deferred.interpreter });
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  assert.equal(deferred.calls, 1);
  assert.equal(deferred.signal?.aborted, false);

  // The user hangs up while the interpreter is still thinking.
  s.executor.cancelAll("call ended");
  // Cancelling must abort the request, not merely ignore its answer.
  assert.equal(deferred.signal?.aborted, true);

  deferred.answer({ kind: "action", action: { name: "clear_selection" } });
  await flush();

  assert.deepEqual(s.host.calls, [], "a stale result reached the app");
  assert.equal(spoken(s.injections).length, 0, "a stale result was spoken");
});

test("a board change during interpretation is replanned, not applied blind", async () => {
  // Some plans are derived from board state ("acknowledge the alert" resolves
  // to whichever one is open), so a plan is only valid for its revision.
  const host = createFakeHost();
  let calls = 0;
  const interpreter: RequestInterpreter = {
    id: "bumps-once",
    interpret(request) {
      calls += 1;
      // The user clicks something while the first interpretation is running.
      if (calls === 1) host.bumpRevision();
      return Promise.resolve<InterpretedRequest>({
        kind: "action",
        action: { name: "set_view", view: request.snapshot.revision % 2 === 0 ? "arrivals" : "departures" },
      });
    },
  };

  const s = setup({ interpreter, host });
  s.transcript.append("user", "show me arrivals", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  assert.equal(calls, 2, "the plan was not replanned against the new revision");
  assert.ok(s.logs.some((entry) => entry.detail.includes("replanning")));
  // Exactly one view change was applied, from the replan.
  assert.deepEqual(host.calls, ["setView:arrivals"]);
  assert.equal(spoken(s.injections).length, 1);
});

test("a board that keeps moving refuses the request out loud", async () => {
  const host = createFakeHost();
  const interpreter: RequestInterpreter = {
    id: "always-bumps",
    interpret() {
      // The board changes during every interpretation attempt.
      host.bumpRevision();
      return Promise.resolve<InterpretedRequest>({ kind: "action", action: { name: "clear_selection" } });
    },
  };

  const s = setup({ interpreter, host });
  s.transcript.append("user", "clear the selection", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  // Nothing applied, and the user is told why rather than left guessing.
  assert.deepEqual(host.calls, []);
  const said = spoken(s.injections);
  assert.equal(said.length, 1);
  assert.match(said[0].content, /board changed/i);
  assert.ok(s.logs.some((entry) => entry.outcome === "rejected" && entry.detail.includes("stale plan")));
});

test("no usable transcript is admitted, not guessed at", async () => {
  const s = setup();
  // Only the agent spoke; there is nothing of the user's to reconstruct.
  s.transcript.append("agent", "Anything else?", 0, 500);
  s.executor.handleDelegation(delegation("item_1", 800));
  await s.settle();

  assert.deepEqual(s.host.calls, []);
  assert.match(spoken(s.injections)[0].content, /did not catch/i);
  assert.equal(s.logs.some((entry) => entry.outcome === "no_transcript"), true);
});

test("an unsupported request is refused and the model told not to claim it", async () => {
  const s = setup();
  s.transcript.append("user", "delay XA101 by an hour", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  assert.deepEqual(s.host.calls, []);
  assert.match(spoken(s.injections)[0].content, /cannot change flight times/i);

  // Session-wide steering, so a later turn cannot imply the work happened.
  const steering = s.injections.filter((entry) => entry.kind === "instructions");
  assert.equal(steering.length, 1);
  assert.equal(steering[0].delegationId, null);
  assert.match(steering[0].content, /Do not say or imply that it was done/i);
});

test("an unclear request asks for what is missing", async () => {
  const s = setup();
  s.transcript.append("user", "do the thing with the aeroplane", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  assert.deepEqual(s.host.calls, []);
  assert.equal(spoken(s.injections).length, 1);
  // Plus quiet context on what Mica can actually do.
  assert.ok(s.injections.some((entry) => entry.kind === "thinking" && entry.content.includes("select a flight")));
  assert.equal(s.logs.some((entry) => entry.outcome === "unclear"), true);
});

test("the interpreter receives conversation and task history", async () => {
  const deferred = deferredInterpreter();
  const s = setup({ interpreter: deferred.interpreter });

  s.transcript.append("user", "show me arrivals", 0, 500);
  s.executor.handleDelegation(delegation("item_1", 600));
  await s.settle();
  deferred.answer({ kind: "action", action: { name: "set_view", view: "arrivals" } });
  await flush();

  // A follow-up needs the earlier exchange and its outcome to resolve.
  s.transcript.append("agent", "Showing arrivals.", 700, 1_200);
  s.transcript.append("user", "no, departures", 2_000, 2_600);
  s.executor.handleDelegation(delegation("item_2", 2_700));
  await s.settle();

  const request = deferred.request;
  assert.ok(request);
  assert.equal(request.utterance, "no, departures");
  assert.match(request.transcript, /User: show me arrivals/);
  assert.match(request.transcript, /Skye: Showing arrivals\./);
  assert.equal(request.taskHistory.length, 1);
  assert.deepEqual(
    { action: request.taskHistory[0].action, outcome: request.taskHistory[0].outcome },
    { action: "set_view", outcome: "applied" },
  );
  assert.ok(request.snapshot.revision > 0);
});

test("a hand-made board change re-sends context, debounced", async () => {
  const s = setup();
  s.executor.syncNow();
  const initial = s.injections.length;
  assert.equal(s.injections[0].kind, "thinking");
  // Session-wide context uses a null delegation id.
  assert.equal(s.injections[0].delegationId, null);

  // A burst of clicking must not become a burst of injections.
  s.executor.noteContextChange(2);
  s.executor.noteContextChange(3);
  s.executor.noteContextChange(4);
  assert.equal(s.injections.length, initial);

  s.scheduler.advance(1_200);
  await flush();
  assert.equal(s.injections.length, initial + 1);
  assert.equal(s.injections.at(-1)?.kind, "thinking");
});

test("an interpreter failure is reported rather than guessed around", async () => {
  const s = setup({
    interpreter: { id: "broken", interpret: () => Promise.reject(new Error("upstream down")) },
  });
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  assert.deepEqual(s.host.calls, []);
  assert.equal(spoken(s.injections).length, 1);
  assert.equal(s.executor.busy, false);
});

test("resetting clears per-session state", async () => {
  const s = setup();
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();
  assert.deepEqual(s.executor.handledDelegationIds, ["item_1"]);

  s.executor.reset();
  assert.deepEqual(s.executor.handledDelegationIds, []);
  assert.deepEqual(s.executor.taskHistory, []);

  // The same id can be used again by the next session.
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();
  assert.equal(s.host.calls.filter((entry) => entry === "selectFlight:T01-ARR").length, 2);
});

test("a disposed executor accepts nothing further", async () => {
  const s = setup();
  s.executor.dispose();
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  s.executor.syncNow();
  s.executor.noteContextChange(9);
  await s.settle();

  assert.deepEqual(s.host.calls, []);
  assert.deepEqual(s.injections, []);
});

/* ------------------------------------------------------------- gestures */

/** A host whose gesture (Skye's cursor) is held until the test releases it. */
function gesturingHost() {
  const host = createFakeHost();
  let release: (() => void) | null = null;
  const gestures: { action: string; signal: AbortSignal }[] = [];
  host.gesture = (action, signal) => {
    gestures.push({ action: action.name, signal });
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  return {
    host,
    gestures,
    click() {
      release?.();
    },
  };
}

test("a write is carried out by the cursor first, then applied", async () => {
  const g = gesturingHost();
  const s = setup({ host: g.host });
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  // The cursor is on its way: nothing applied or said yet.
  assert.deepEqual(g.gestures.map((entry) => entry.action), ["select_flight"]);
  assert.deepEqual(s.host.calls, []);
  assert.equal(spoken(s.injections).length, 0);

  g.click();
  await flush();
  assert.deepEqual(s.host.calls, ["selectFlight:T01-ARR"]);
  assert.match(spoken(s.injections)[0].content, /XA101/);
});

test("a read is not acted out", async () => {
  const g = gesturingHost();
  const s = setup({ host: g.host });
  s.transcript.append("user", "what is selected", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();
  assert.equal(g.gestures.length, 0);
  assert.equal(spoken(s.injections).length, 1);
});

test("a request superseded mid-gesture stops the cursor and is never applied", async () => {
  const g = gesturingHost();
  const s = setup({ host: g.host });
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  s.executor.cancelAll("call ended");
  assert.equal(g.gestures[0].signal.aborted, true);
  g.click();
  await flush();
  assert.deepEqual(s.host.calls, []);
  assert.equal(spoken(s.injections).length, 0);
});

test("the board moving during the gesture (its own clicks) does not block the apply", async () => {
  const g = gesturingHost();
  const s = setup({ host: g.host });
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();

  s.host.bumpRevision();
  g.click();
  await flush();
  assert.deepEqual(s.host.calls, ["selectFlight:T01-ARR"]);
});

test("every write is carried out by the cursor", async () => {
  const g = gesturingHost();
  const s = setup({ host: g.host });
  const run = s.executor.handleTypedRequest("switch to departures");
  await flush();
  assert.deepEqual(g.gestures.map((entry) => entry.action), ["set_view"]);
  g.click();
  await run;
  assert.deepEqual(s.host.calls, ["setView:departures"]);
});

test("a gesture that fails still lets the change through", async () => {
  const host = createFakeHost();
  host.gesture = () => Promise.reject(new Error("no overlay"));
  const s = setup({ host });
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();
  assert.deepEqual(s.host.calls, ["selectFlight:T01-ARR"]);
});

/* -------------------------------------------------------- typed requests */

test("a typed request is applied and answered, not spoken", async () => {
  const s = setup();
  const reply = await s.executor.handleTypedRequest("select XA101");
  assert.deepEqual(s.host.calls, ["selectFlight:T01-ARR"]);
  assert.match(reply ?? "", /XA101/);
  assert.equal(spoken(s.injections).length, 0);
  // Context still follows the change, session-wide since nothing delegated it.
  assert.ok(s.injections.some((entry) => entry.kind === "thinking" && entry.delegationId === null));
  assert.equal(s.executor.busy, false);
});

test("a typed request supersedes voice work in flight", async () => {
  const deferred = deferredInterpreter();
  const s = setup({ interpreter: deferred.interpreter });
  s.transcript.append("user", "select XA101", 600, 1_000);
  s.executor.handleDelegation(delegation("item_1"));
  await s.settle();
  const voiceSignal = deferred.signal;

  const typed = s.executor.handleTypedRequest("clear the selection");
  assert.equal(voiceSignal?.aborted, true);
  deferred.answer({ kind: "action", action: { name: "clear_selection" } });
  assert.match((await typed) ?? "", /Cleared/);
  assert.deepEqual(s.host.calls, ["clearSelection"]);
});

test("a superseded typed request resolves with no reply", async () => {
  const deferred = deferredInterpreter();
  const s = setup({ interpreter: deferred.interpreter });
  const first = s.executor.handleTypedRequest("select XA101");
  await flush();
  s.executor.cancelAll("newer request");
  // A late answer for a cancelled request must not land.
  deferred.answer({ kind: "action", action: { name: "select_flight", flightId: "T01-ARR" } });
  assert.equal(await first, null);
  assert.deepEqual(s.host.calls, []);
});

test("the flight holding its stand longest is found and selected", async () => {
  const s = setup();
  const reply = await s.executor.handleTypedRequest("hey Skye, which flight is taking up the longest stand / gate time?");
  assert.deepEqual(s.host.calls, ["selectFlight:T21-ARR"]);
  assert.match(reply ?? "", /XA113.*10h 10m/);
});

test("counting flights on a stand is not read as a stand-time question", async () => {
  const s = setup();
  await s.executor.handleTypedRequest("which stand has the most flights");
  assert.deepEqual(s.host.calls, []);
});

test("a swap is asked about first: declined, nothing moves; approved, it is made", async () => {
  const { resetStands, occupancyById } = await import("../src/operations/allocation.ts");
  try {
    for (const answer of [false, true]) {
      resetStands();
      const host = createFakeHost();
      const asked: string[] = [];
      const gestures: string[] = [];
      host.confirm = async (action) => {
        asked.push(action.name);
        return answer;
      };
      host.gesture = async (action) => {
        gestures.push(action.name);
      };
      const s = setup({ host });
      s.transcript.append("user", "swap XA103 with XC332", 600, 1_000);
      s.executor.handleDelegation(delegation(`item_${answer}`));
      await s.settle();

      assert.deepEqual(asked, ["swap_stays"]);
      if (answer) {
        // Approved: Skye drags, then the swap is made.
        assert.deepEqual(gestures, ["swap_stays"]);
        assert.equal(host.calls[0], "swap:T02-1:T08-1");
        assert.ok(host.calls.slice(1).every((call) => call.startsWith("selectFlights:")));
        assert.equal(occupancyById("T02-1")?.rowId, "A3");
      } else {
        // Declined: no drag, no change, and Skye says so.
        assert.deepEqual(gestures, []);
        assert.deepEqual(host.calls, []);
        assert.equal(occupancyById("T02-1")?.rowId, "A1");
        assert.match(spoken(s.injections)[0].content, /Nothing changed/);
      }
    }
  } finally {
    resetStands();
  }
});

test("asked to give stands, Skye acts it out, places what fits and says why the rest can't be placed", async () => {
  const { resetStands } = await import("../src/operations/allocation.ts");
  try {
    const host = createFakeHost();
    const gestures: string[] = [];
    host.gesture = async (action) => {
      gestures.push(action.name);
    };
    const s = setup({ host });
    const reply = await s.executor.handleTypedRequest("give the no-stand flights stands");
    assert.deepEqual(gestures, ["assign_stands"]);
    assert.equal(host.calls[0], "assignStands:U01-1>C27|U02-1>A3|U03-1>C25|U04-1>D44");
    assert.match(reply ?? "", /^Placed XB240 on C27/);
    assert.match(reply ?? "", /XB241 has no stay times/);
  } finally {
    resetStands();
  }
});

test("on a call, what Skye talks about is selected as she says it, not during the summary before", async () => {
  const s = setup();
  s.transcript.append("user", "start my day", 600, 1_000);
  s.executor.handleDelegation(delegation("item_brief"));
  await s.settle();
  assert.match(spoken(s.injections)[0].content, /^9 open items/);
  // Skye's summary: the alerts open, compact, but nothing is selected yet.
  s.transcript.append("agent", "Morning. You've got nine open items: two conflicts, five flights with no stand", 2_000, 4_000);
  assert.deepEqual(s.host.calls, ["showAlerts:"]);
  // She gets to the first conflict: its two stays are selected, and it is picked out in the list.
  s.transcript.append("agent", " and a couple of notices. I'd start with the A1 conflict,", 4_000, 6_000);
  assert.deepEqual(s.host.calls.slice(1), ["selectFlights:replace:T02-ARR|T03-ARR", "showAlerts:ALERT-CLASH-T02-1-end"]);
  // Then the next one: the selection moves with her, to the late stay and what it runs into.
  s.transcript.append("agent", " then the B11 conflict after that.", 6_000, 8_000);
  assert.deepEqual(s.host.calls.slice(-2), ["selectFlights:replace:T24-ARR|T25-ARR|T26-ARR", "showAlerts:ALERT-CLASH-T24-1-end"]);
  // Quiet a while: the alerts close.
  s.scheduler.advance(5_000);
  assert.equal(s.host.calls.at(-1), "hideAlerts");
  // A newer request ends them.
  s.transcript.append("user", "clear the selection", 9_000, 9_500);
  s.executor.handleDelegation(delegation("item_clear", 9_500));
  await s.settle();
  const before = s.host.calls.length;
  s.transcript.append("agent", "Back to the A1 conflict.", 10_000, 11_000);
  assert.equal(s.host.calls.length, before);
});
