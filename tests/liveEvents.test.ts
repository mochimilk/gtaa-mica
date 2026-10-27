// Event parsing and the injection content budget.
import assert from "node:assert/strict";
import test from "node:test";
import {
  clampInjectionContent,
  closeEvent,
  injectionByteLength,
  injectionEvent,
  MAX_INJECTION_BYTES,
  muteEvent,
  parseLiveEvent,
} from "../src/live/liveEvents.ts";

test("transcript deltas keep their timeline positions and role", () => {
  const user = parseLiveEvent(
    JSON.stringify({ type: "session.input_transcript.delta", delta: "What is", start_ms: 1000, end_ms: 1200 }),
  );
  assert.deepEqual(user, {
    type: "session.input_transcript.delta",
    role: "user",
    delta: "What is",
    startMs: 1000,
    endMs: 1200,
  });

  const agent = parseLiveEvent(
    JSON.stringify({ type: "session.output_transcript.delta", delta: "Sure", start_ms: 50, end_ms: 90 }),
  );
  assert.equal(agent?.type === "session.output_transcript.delta" && agent.role, "agent");

  // A missing end_ms falls back to the start, never to NaN.
  const partial = parseLiveEvent(JSON.stringify({ type: "session.input_transcript.delta", delta: "x", start_ms: 7 }));
  assert.equal(partial?.type === "session.input_transcript.delta" && partial.endMs, 7);
});

test("delegation events carry ids and an offset, not a task", () => {
  const event = parseLiveEvent(
    JSON.stringify({
      type: "session.delegation.created",
      event_id: "event_delegation",
      offset_ms: 1000,
      delegation: { id: "item_9tA2", type: "delegation", target: "client" },
    }),
  );
  assert.deepEqual(event, {
    type: "session.delegation.created",
    delegationId: "item_9tA2",
    target: "client",
    offsetMs: 1000,
  });

  // No id means nothing can be correlated, so it is not a delegation.
  const idless = parseLiveEvent(JSON.stringify({ type: "session.delegation.created", delegation: {} }));
  assert.equal(idless?.type, "unknown");
});

test("lifecycle, acknowledgement and error events parse", () => {
  const started = parseLiveEvent(JSON.stringify({ type: "session.started", session: { id: "live_1" } }));
  assert.equal(started?.type === "session.started" && started.sessionId, "live_1");

  const closed = parseLiveEvent(
    JSON.stringify({ type: "session.closed", usage: { seconds: 12 }, reason: "close_requested" }),
  );
  assert.deepEqual(closed, { type: "session.closed", reason: "close_requested", usageSeconds: 12 });

  const ack = parseLiveEvent(JSON.stringify({ type: "session.commentary.appended", client_event_id: "mica_inj_1" }));
  assert.equal(ack?.type === "session.commentary.appended" && ack.clientEventId, "mica_inj_1");

  const error = parseLiveEvent(
    JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", code: "immutable_field_update", message: "nope", client_event_id: "e1" },
    }),
  );
  assert.equal(error?.type === "error" && error.code, "immutable_field_update");
});

test("unparseable or unknown messages never throw", () => {
  assert.equal(parseLiveEvent("not json"), null);
  assert.equal(parseLiveEvent("{}"), null);
  assert.equal(parseLiveEvent(JSON.stringify({ type: "session.brand.new" }))?.type, "unknown");
});

test("outgoing events use the documented names and never session.start", () => {
  assert.equal(muteEvent("m1", true).type, "session.input_audio.mute");
  assert.equal(muteEvent("m1", false).type, "session.input_audio.unmute");
  assert.equal(closeEvent().type, "session.close");

  const commentary = injectionEvent("commentary", "e1", "item_1", "Done.");
  assert.deepEqual(commentary, {
    type: "session.commentary.append",
    event_id: "e1",
    delegation_id: "item_1",
    content: "Done.",
  });
  assert.equal(injectionEvent("thinking", "e2", null, "fact").type, "session.thinking.append");
  // Session-wide context uses a null delegation id, as documented.
  assert.equal(injectionEvent("instructions", "e3", null, "steer").delegation_id, null);
});

test("injected content is bounded in UTF-8 bytes, not characters", () => {
  // A byte bound is what actually bounds tokens: byte-level BPE gives
  // tokens <= utf8Bytes, so these cases cannot exceed 500 tokens.
  const cases = [
    "ascii prose ".repeat(200),
    // CJK: three UTF-8 bytes per character, so a character budget would pass
    // text well over the token limit.
    "東京国際空港の搭乗橋".repeat(120),
    // Dense identifiers tokenize at roughly one or two characters per token.
    "a1B2c3D4e5F6g7H8".repeat(120),
    // Combining marks and astral characters must not be split mid-sequence.
    "éàçüñ🛬🛫👨‍👩‍👧‍👦".repeat(120),
    "عربى نص طويل ".repeat(120),
  ];

  for (const input of cases) {
    const clamped = clampInjectionContent(input);
    assert.ok(
      injectionByteLength(clamped) <= MAX_INJECTION_BYTES,
      `clamped to ${injectionByteLength(clamped)} bytes, over the ${MAX_INJECTION_BYTES} budget`,
    );
    // Still valid text: no lone surrogate from slicing mid code point.
    assert.equal(clamped.includes("�"), false);
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(clamped), false);
    assert.ok(clamped.endsWith("…"));
  }

  // Real injections are far below the budget and pass through untouched.
  const short = "Selected XA101, arrival on stand A1.";
  assert.equal(clampInjectionContent(short), short);
  // Whitespace is normalised so a budget is not spent on newlines.
  assert.equal(clampInjectionContent("  a \n\n b  "), "a b");

  // Every injection builder clamps, not just direct callers.
  const built = injectionEvent("thinking", "e1", null, "字".repeat(1000));
  assert.ok(injectionByteLength(String(built.content)) <= MAX_INJECTION_BYTES);
});
