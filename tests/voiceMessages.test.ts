// Folding a call's transcript into the Ask Skye conversation. Pure: no React,
// no Coral runtime, no transport.
import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "@coral-ai/chat";
import { mergeVoiceTurns, VOICE_MESSAGE_TYPE, voiceMessageId } from "../src/components/ask-skye/voiceMessages.ts";

const typed: ChatMessage[] = [
  { id: "t1", role: "user", content: "List the open alerts" },
  { id: "t2", role: "assistant", content: "2 open demo alerts." },
];

test("a call's turns are appended after the typed conversation, as spoken messages", () => {
  const merged = mergeVoiceTurns(typed, 1, [
    { role: "user", text: "Select XA101" },
    { role: "agent", text: "Selected XA101." },
  ]);
  assert.deepEqual(
    merged.map((message) => [message.id, message.role, message.content]),
    [
      ["t1", "user", "List the open alerts"],
      ["t2", "assistant", "2 open demo alerts."],
      [voiceMessageId(1, 0), "user", "Select XA101"],
      [voiceMessageId(1, 1), "assistant", "Selected XA101."],
    ],
  );
  assert.equal(merged[3].type, VOICE_MESSAGE_TYPE);
  assert.equal(merged[3].metadata?.spoken, true);
});

test("growing turns update in place, and re-merging the same turns changes nothing", () => {
  const first = mergeVoiceTurns(typed, 1, [{ role: "user", text: "Select" }]);
  const grown = mergeVoiceTurns(first, 1, [{ role: "user", text: "Select XA101" }]);
  assert.equal(grown.length, 3);
  assert.equal(grown[2].content, "Select XA101");
  // Idempotent: the same array comes back, so no state update is needed.
  assert.equal(mergeVoiceTurns(grown, 1, [{ role: "user", text: "Select XA101" }]), grown);
});

test("turns dropped by Coral settling a typed reply are put back", () => {
  const withVoice = mergeVoiceTurns(typed, 2, [{ role: "agent", text: "Hi" }]);
  // Coral replaces the list with its own snapshot when a typed reply settles.
  const settled = [...typed, { id: "t3", role: "user" as const, content: "Thanks" }];
  const restored = mergeVoiceTurns(settled, 2, [{ role: "agent", text: "Hi" }]);
  assert.equal(withVoice.length, 3);
  assert.deepEqual(
    restored.map((message) => message.id),
    ["t1", "t2", "t3", voiceMessageId(2, 0)],
  );
});

test("a turn merged away by a late delta is removed; earlier calls are untouched", () => {
  const earlier = mergeVoiceTurns([], 1, [{ role: "user", text: "From the first call" }]);
  const two = mergeVoiceTurns(earlier, 2, [
    { role: "user", text: "Show" },
    { role: "agent", text: "Okay" },
  ]);
  const one = mergeVoiceTurns(two, 2, [{ role: "user", text: "Show arrivals" }]);
  assert.deepEqual(
    one.map((message) => [message.id, message.content]),
    [
      [voiceMessageId(1, 0), "From the first call"],
      [voiceMessageId(2, 0), "Show arrivals"],
    ],
  );
});

test("before any call there is nothing to merge", () => {
  assert.equal(mergeVoiceTurns(typed, 0, [{ role: "user", text: "ignored" }]), typed);
});
