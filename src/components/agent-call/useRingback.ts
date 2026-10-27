import * as React from "react";
import connectSound from "./proximity-notification.wav";
import callingSound from "./ring.mp3";

/**
 * Plays Windows' proximity chime once as a call to Skye starts connecting.
 *
 * Answering is the session's business; this only marks the start. The chime
 * is short (under two seconds), so it plays out even if the call connects
 * first.
 */
export function useConnectChime(connecting: boolean): void {
  React.useEffect(() => {
    if (!connecting) return;
    // Started by the Connect click, so autoplay allows it; a blocked play just
    // stays silent, which is cosmetic — the call itself is unaffected.
    new Audio(connectSound).play().catch(() => {});
  }, [connecting]);
}

/**
 * Loops the outgoing-call tone while anyone is being called in, and stops as
 * soon as nobody is: they have all answered, or the calls were stopped.
 */
export function useRingback(ringing: boolean): void {
  React.useEffect(() => {
    if (!ringing) return undefined;
    const audio = new Audio(callingSound);
    audio.loop = true;
    // Started by a Call click (or Skye's), after the page has been used, so
    // autoplay allows it; a blocked play just stays silent.
    audio.play().catch(() => {});
    return () => {
      audio.pause();
    };
  }, [ringing]);
}
