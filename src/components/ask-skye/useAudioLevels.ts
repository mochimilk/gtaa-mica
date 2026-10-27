import { useEffect, useState } from "react";

/** How many recent levels the waveform draws, oldest first. */
const HISTORY = 48;
/** Sampling interval; the waveform eases between samples in CSS. */
const SAMPLE_MS = 60;
/** RMS of quiet speech is small; this lifts it into a readable bar height. */
const GAIN = 4;

/**
 * Recent loudness of the call's audio, 0 to 1, for the voice bar's waveform:
 * the louder of the caller's microphone and the agent's voice at each sample,
 * so the bars move whoever is speaking. Read-only metering: the streams stay
 * owned by the call transport, nothing is recorded, and a muted microphone
 * reads as silence because its track is disabled.
 *
 * Returns undefined when there is nothing to meter, so the waveform falls back
 * to its breathing animation.
 */
export function useAudioLevels(streams: readonly (MediaStream | null)[]): readonly number[] | undefined {
  const [levels, setLevels] = useState<readonly number[] | undefined>(undefined);
  const live = streams.filter((stream): stream is MediaStream => !!stream && stream.getAudioTracks().length > 0);
  // Re-run only when the set of streams changes, not on every render.
  const key = live.map((stream) => stream.id).join("|");

  useEffect(() => {
    if (live.length === 0 || typeof AudioContext === "undefined") {
      setLevels(undefined);
      return undefined;
    }
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      setLevels(undefined);
      return undefined;
    }
    const analysers = live.flatMap((stream) => {
      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        return [{ source, analyser, buffer: new Float32Array(analyser.fftSize) }];
      } catch {
        return [];
      }
    });
    // A context created outside a gesture can start suspended; the call itself
    // was started by one, so resuming is expected to succeed.
    void context.resume().catch(() => undefined);

    let history: number[] = [];
    const timer = window.setInterval(() => {
      let peak = 0;
      for (const { analyser, buffer } of analysers) {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        peak = Math.max(peak, Math.sqrt(sum / buffer.length));
      }
      history = [...history.slice(-(HISTORY - 1)), Math.min(1, peak * GAIN)];
      // Silence draws as the breathing fallback rather than a flat line.
      setLevels(history.some((level) => level > 0.02) ? history : undefined);
    }, SAMPLE_MS);

    return () => {
      window.clearInterval(timer);
      for (const { source, analyser } of analysers) {
        source.disconnect();
        analyser.disconnect();
      }
      void context.close().catch(() => undefined);
      setLevels(undefined);
    };
    // `live` is derived from `streams`; `key` captures exactly when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return levels;
}
