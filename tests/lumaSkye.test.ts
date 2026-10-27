import assert from "node:assert/strict";
import test from "node:test";
import { skyeState } from "../src/components/luma-skye/state.ts";
import { VoiceMeter } from "../src/components/luma-skye/voiceMeter.ts";
import type { LiveCallState } from "../src/live/callController.ts";

const idle: LiveCallState = {
  phase: "idle", startedAt: null, muted: false, sessionId: null,
  error: null, agentSpeaking: false, working: false,
};

test("skye follows call state, mute, blocked playback and typed work", () => {
  const state = (changes: Partial<LiveCallState>, blocked = false) => skyeState({ ...idle, ...changes }, blocked);
  assert.equal(state({}), "idle");
  assert.equal(state({ phase: "starting" }), "connecting");
  assert.equal(state({ phase: "connecting" }), "connecting");
  assert.equal(state({ phase: "connected" }), "listening");
  assert.equal(state({ phase: "connected", muted: true }), "idle");
  assert.equal(state({ working: true }), "thinking");
  assert.equal(state({ phase: "connected", agentSpeaking: true, working: true }), "speaking");
  assert.equal(state({ phase: "connected", agentSpeaking: true, working: true }, true), "thinking");
  assert.equal(state({ phase: "closing", working: true }), "idle");
  assert.equal(state({ phase: "failed", working: true }), "unavailable");
});

test("meter only measures supplied streams and releases taps without stopping audio", async () => {
  const original = globalThis.AudioContext;
  let sample = 0;
  let sourceDisconnects = 0;
  let analyserDisconnects = 0;
  let contextCloses = 0;
  let contexts = 0;
  const connections: unknown[] = [];
  class FakeContext {
    state = "running";
    destination = {};
    constructor() { contexts++; }
    resume() { return Promise.resolve(); }
    close() { contextCloses++; return Promise.resolve(); }
    createMediaStreamSource() {
      return { connect: (node: unknown) => connections.push(node), disconnect: () => sourceDisconnects++ };
    }
    createAnalyser() {
      return {
        fftSize: 1024,
        getFloatTimeDomainData: (samples: Float32Array) => samples.fill(sample),
        disconnect: () => analyserDisconnects++,
      };
    }
  }
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  const meter = new VoiceMeter();
  const stream = { getAudioTracks: () => [{}] } as unknown as MediaStream;
  try {
    assert.equal(contexts, 0, "idle mount must not start Web Audio");
    assert.equal(meter.input(), 0);
    meter.wake();
    meter.setInput(stream);
    meter.setOutput(stream);
    assert.equal(connections.length, 2);
    assert.ok(connections.every((node) => "getFloatTimeDomainData" in (node as object)), "never connect to speakers");
    sample = 0;
    assert.equal(meter.input(), 0);
    sample = 0.001;
    assert.ok(meter.input() < 0.001, "-60 dBFS is the floor");
    sample = 10 ** (-18 / 20);
    assert.ok(meter.output() > 0.999, "-18 dBFS reaches full level");
    meter.setInput(null);
    assert.equal(meter.input(), 0);
    meter.dispose();
    assert.equal(meter.output(), 0);
    assert.equal(sourceDisconnects, 2);
    assert.equal(analyserDisconnects, 2);
    assert.equal(contextCloses, 1);
    meter.dispose();
    assert.equal(contextCloses, 1, "cleanup is idempotent");
  } finally {
    meter.dispose();
    if (original) globalThis.AudioContext = original;
    else Reflect.deleteProperty(globalThis, "AudioContext");
  }
});
