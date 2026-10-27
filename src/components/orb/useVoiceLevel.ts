import * as React from "react";

/** Quiet-room RMS below which the meter reads silence. */
const NOISE_FLOOR = 0.01;
/** RMS of quiet speech is small; this lifts normal speech toward 1. */
const GAIN = 5;
/** Smoothing time constants in seconds: quick to rise with a word, slower to settle after it. */
const ATTACK = 0.06;
const RELEASE = 0.3;

/**
 * Smoothed loudness of `stream`, 0 to 1, kept in the returned ref and passed
 * to `onLevel` every animation frame. Read-only metering: the stream stays
 * owned by whoever made it, nothing is recorded or played back, and a muted
 * microphone reads as silence because its track is disabled.
 */
export function useVoiceLevel(
  stream: MediaStream | null | undefined,
  onLevel: (level: number) => void,
): React.RefObject<number> {
  const levelRef = React.useRef(0);
  const onLevelRef = React.useRef(onLevel);
  onLevelRef.current = onLevel;

  React.useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0 || typeof AudioContext === "undefined") return undefined;
    let context: AudioContext;
    let source: MediaStreamAudioSourceNode;
    try {
      context = new AudioContext();
    } catch {
      return undefined;
    }
    try {
      source = context.createMediaStreamSource(stream);
    } catch {
      void context.close().catch(() => undefined);
      return undefined;
    }
    const meter = context.createAnalyser();
    meter.fftSize = 512;
    source.connect(meter);
    // The call that owns the stream was started by a click, so resuming outside
    // a gesture is expected to succeed.
    void context.resume().catch(() => undefined);

    const buffer = new Float32Array(meter.fftSize);
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      meter.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      const target = Math.min(1, Math.max(0, Math.sqrt(sum / buffer.length) - NOISE_FLOOR) * GAIN);
      const tau = target > levelRef.current ? ATTACK : RELEASE;
      levelRef.current += (target - levelRef.current) * (1 - Math.exp(-dt / tau));
      if (levelRef.current < 0.001) levelRef.current = 0;
      onLevelRef.current(levelRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      meter.disconnect();
      void context.close().catch(() => undefined);
      levelRef.current = 0;
      onLevelRef.current(0);
    };
  }, [stream]);

  return levelRef;
}
