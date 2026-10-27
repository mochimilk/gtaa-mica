// Transcript accumulation. GPT-Live deltas have no item id, no turn-complete
// event, and uneven delivery, so ordering is by timeline position.
import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptLog } from "../src/live/transcript.ts";

test("out-of-order deltas are ordered by timeline position", () => {
  const log = new TranscriptLog();
  log.append("user", "the board", 300, 400);
  log.append("user", "Show me", 100, 200);
  log.append("agent", "Sure.", 500, 600);

  assert.deepEqual(
    log.segments().map((segment) => segment.text),
    ["Show me", "the board", "Sure."],
  );
  assert.equal(log.transcriptText(), "User: Show me the board\nSkye: Sure.");
});

test("deltas at the same position keep arrival order", () => {
  const log = new TranscriptLog();
  log.append("user", "a", 100, 100);
  log.append("user", "b", 100, 100);
  log.append("user", "c", 100, 100);
  assert.equal(log.transcriptText(), "User: abc");
});

test("contiguous fragments join without inventing spaces", () => {
  const log = new TranscriptLog();
  // Fragments carry their own spacing, as the delta examples show.
  log.append("user", "What is", 1000, 1200);
  log.append("user", " the stand", 1200, 1400);
  assert.equal(log.transcriptText(), "User: What is the stand");

  const gapped = new TranscriptLog();
  gapped.append("user", "Select XA101", 0, 500);
  gapped.append("user", "clear it", 5000, 5400);
  // A real silence gets a separator rather than fusing two sentences.
  assert.equal(gapped.transcriptText(), "User: Select XA101 clear it");
});

test("the request at a delegation offset is the last run of user speech", () => {
  const log = new TranscriptLog();
  log.append("user", "Show me arrivals", 0, 1000);
  log.append("agent", "Here they are.", 1200, 2000);
  log.append("user", "Now select", 8000, 8600);
  log.append("user", " XA101", 8600, 9000);

  // Delegated just after the second request.
  assert.equal(log.userRequestAt(9100), "Now select XA101");
  // Earlier speech, separated by a long silence, is not pulled in.
  assert.equal(log.userRequestAt(9100).includes("arrivals"), false);
  // Delegated during the first request.
  assert.equal(log.userRequestAt(1000), "Show me arrivals");
});

test("a delegation that lands before the final deltas still sees them", () => {
  const log = new TranscriptLog();
  // The model can delegate as soon as it understands, while the tail of the
  // same sentence is still being transcribed.
  log.append("user", "Select", 4000, 4400);
  log.append("user", " XA101 please", 4600, 5200);
  assert.equal(log.userRequestAt(4500), "Select XA101 please");
});

test("no user speech near the offset yields an empty request", () => {
  const log = new TranscriptLog();
  log.append("agent", "Anything else?", 0, 800);
  assert.equal(log.userRequestAt(1000), "");

  const stale = new TranscriptLog();
  stale.append("user", "something long ago", 0, 500);
  // Well outside the lookback window.
  assert.equal(stale.userRequestAt(90_000), "");
});

test("clearing resets the log between calls", () => {
  const log = new TranscriptLog();
  log.append("user", "hello", 0, 100);
  assert.equal(log.lastActivityMs(), 100);
  log.clear();
  assert.equal(log.segments().length, 0);
  assert.equal(log.transcriptText(), "");
  assert.equal(log.lastActivityMs(), null);
});
