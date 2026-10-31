// Skye on the user's own OpenAI key, in the desktop app: Settings → API hands
// it to the main process (electron/appVoice.mjs), which keeps it for this
// window until it reloads or closes and answers Mica's voice routes with it
// (liveFetch, ./liveBackend). The page can hand a key over and take it away,
// and see a masked form of it, never read it back. In a browser there is no
// bridge, and none of this.

/** The voice broker's routes (server/micaLiveServer.mjs) the app answers. */
export type DesktopVoiceRoute = "session" | "interpret" | "health";

/** Who a key is for: Skye runs on OpenAI only, for now. */
export type VoiceProvider = "openai";

/** A window's key as the page may see it: its provider, and its masked form (sk-proj-…a1b2). */
export type VoiceKey = { provider: VoiceProvider; hint: string };

/** The desktop shell's voice bridge (electron/preload.cjs). */
type MicaVoice = {
  /** Gives this window the key; false when it isn't shaped like one. */
  setApiKey(provider: VoiceProvider, key: string): Promise<boolean>;
  describeApiKey(): Promise<VoiceKey | null>;
  forgetApiKey(): Promise<void>;
  /** One route, answered with this window's key, as the broker would; null when it has none. */
  request(id: string, route: DesktopVoiceRoute, body: string | undefined): Promise<{ status: number; body: unknown } | null>;
  abort(id: string): void;
};

declare global {
  interface Window {
    micaVoice?: MicaVoice;
  }
}

/** The bridge, in the desktop app only. */
export function desktopVoice(): MicaVoice | undefined {
  return typeof window === "undefined" ? undefined : window.micaVoice;
}

// Counts the key changes, for useSyncExternalStore, so whatever shows Skye's
// readiness checks it again.
let revision = 0;
const listeners = new Set<() => void>();

function changed() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeVoiceKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const voiceKeyRevision = () => revision;

/** This window's key, masked; never the key itself. */
export async function voiceKey(): Promise<VoiceKey | null> {
  return (await desktopVoice()?.describeApiKey()) ?? null;
}

/** Gives this window a key, in place of any it had; false when it isn't shaped like one. */
export async function setVoiceKey(provider: VoiceProvider, key: string): Promise<boolean> {
  const set = (await desktopVoice()?.setApiKey(provider, key)) === true;
  if (set) changed();
  return set;
}

export async function forgetVoiceKey(): Promise<void> {
  await desktopVoice()?.forgetApiKey();
  changed();
}
