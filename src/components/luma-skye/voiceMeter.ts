/**
 * How loud the traveller's microphone and the assistant's voice are, for the
 * skye at the bottom of the screen. Web Audio analysers only measure: nothing
 * is recorded, played or sent anywhere, and the analysers aren't connected to
 * the speakers.
 */

/** Speech sits roughly between these levels (dBFS), which map to 0 and 1. */
const FLOOR_DB = -60
const CEILING_DB = -18

interface Tap {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  samples: Float32Array<ArrayBuffer>
}

export class VoiceMeter {
  #context: AudioContext | null = null
  #input: Tap | null = null
  #output: Tap | null = null

  /** Starts audio processing. Call it from a press: browsers only allow audio to start after one. */
  wake(): void {
    try {
      this.#context ??= new AudioContext()
      if (this.#context.state === 'suspended') void this.#context.resume().catch(() => {})
    } catch {
      // No Web Audio: the skye just doesn't follow the voice.
    }
  }

  /** The microphone. Its track is disabled while muted, so it reads 0 then. */
  setInput(stream: MediaStream | null): void {
    this.#input = this.#retap(this.#input, stream)
  }

  /** The assistant's audio. */
  setOutput(stream: MediaStream | null): void {
    this.#output = this.#retap(this.#output, stream)
  }

  input(): number {
    return loudness(this.#input)
  }

  output(): number {
    return loudness(this.#output)
  }

  dispose(): void {
    this.setInput(null)
    this.setOutput(null)
    void this.#context?.close().catch(() => {})
    this.#context = null
  }

  #retap(tap: Tap | null, stream: MediaStream | null): Tap | null {
    if (tap?.stream === stream) return tap
    tap?.source.disconnect()
    tap?.analyser.disconnect()
    if (!stream || !this.#context || stream.getAudioTracks().length === 0) return null
    try {
      const source = this.#context.createMediaStreamSource(stream)
      const analyser = this.#context.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      return { stream, source, analyser, samples: new Float32Array(analyser.fftSize) }
    } catch {
      // For example a sample-rate mismatch in Firefox.
      return null
    }
  }
}

/** RMS level of the latest ~20 ms, mapped from `FLOOR_DB`–`CEILING_DB` to 0–1. */
function loudness(tap: Tap | null): number {
  if (!tap) return 0
  tap.analyser.getFloatTimeDomainData(tap.samples)
  let sum = 0
  for (const sample of tap.samples) sum += sample * sample
  const rms = Math.sqrt(sum / tap.samples.length)
  if (rms === 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)))
}
