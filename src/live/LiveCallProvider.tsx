// React glue for the shared call controller.
//
// This is the only file that knows both React and the live session. It
//   - implements OperationsHost over OperationsContext,
//   - gives the controller the browser's real WebRTC and microphone,
//   - plays the agent's audio, and a teammate's who answers her aloud
//     (./teammateVoice), whose session hears silence,
//   - and re-sends board context when the user changes something by hand.
//
// Mount it inside OperationsProvider so a voice request reaches the same
// selection, views, filters and acknowledgements the UI uses. It owns no
// layout and renders no chrome.
import * as React from "react";
import { useOperations } from "../operations/OperationsContext.tsx";
import { OPS_FLIGHTS_BY_ID } from "../operations/operationsData.ts";
import { agentCursor } from "../components/agent-cursor";
import { playAgentGesture } from "../operations/agentGestures.ts";
import { markDisruptionRunning } from "../operations/disruption.ts";
import { beginSkyeChange, setAnswerAloud } from "../operations/skyeReview.ts";
import { resolveInterpreter } from "./backendInterpreter.ts";
import { LiveCallController, type LiveCallState } from "./callController.ts";
import { requestLiveSession, type LivePersona } from "./liveBackend.ts";
import { phraseInterpreter, withDemoShortcuts } from "./requestInterpreter.ts";
import { guestNames, inviteToCall, removeFromCall as removeGuest, subscribeCallGuests } from "./callGuests.ts";
import { TeammateVoice } from "./teammateVoice.ts";
import { hideSkyeAlerts, showSkyeAlerts } from "../operations/skyeAlerts.ts";
import { LiveTransport, type TransportHandlers } from "./liveTransport.ts";
import { buildSnapshot, type OperationsHost, type OpsSnapshot } from "./opsHost.ts";
import type { AppAction } from "./appActions.ts";
import type { ExecutorLogEntry } from "./executor.ts";
import type { TranscriptTurn } from "./transcript.ts";
import { VoiceMeter } from "../components/luma-skye/voiceMeter";

export type LiveCallValue = {
  state: LiveCallState;
  /** A call exists (connecting or up). `phase` has the detail. */
  active: boolean;
  startCall: () => void;
  hangup: () => void;
  setMuted: (muted: boolean) => void;
  /**
   * The agent's audio could not start playing — almost always the browser's
   * autoplay policy. The call is connected but silent, so the UI must offer
   * `resumeAudio` from a user gesture.
   */
  audioBlocked: boolean;
  resumeAudio: () => void;
  /**
   * Sends a request typed in the chat to the same executor voice requests
   * use, so Skye acts on it (cursor and all) with or without a call.
   * Resolves with Skye's reply, or null if a newer request replaced it.
   */
  runTypedRequest: (text: string) => Promise<string | null>;
  /**
   * Stops the typed request in progress, if one is running; voice work is left
   * alone. The stopped request resolves to null and changes nothing.
   */
  cancelTypedRequest: () => void;
  /** Has Skye say `text` on the call, in her own words; false when no call is connected. */
  say: (text: string) => boolean;
  /**
   * As `say`, once she has finished what she is saying; resolves true once
   * she has said it, false when she was not heard (see LiveCallController.speak).
   * `onWords` hears what she has said of it so far, as her words arrive;
   * `ended` says when that has come to its end.
   */
  speak: (text: string, onWords?: (said: string) => void, ended?: (said: string) => boolean) => Promise<boolean>;
  /** Starts the session of a teammate answering Skye aloud (./teammateVoice) ahead of his turn. */
  teammateReady: (name: string) => void;
  /**
   * A teammate answering Skye aloud comes off mute and says what `cue` asks,
   * knowing `context` without saying it, Skye not listening meanwhile.
   * Resolves true once he has said it (`ended` says when what he has said has
   * come to its end), false when he never got to.
   */
  teammateAnswers: (
    name: string,
    cue: string,
    ended?: (said: string) => boolean,
    context?: string,
  ) => Promise<boolean>;
  /** The teammate speaking on the call, for their tile; null when none is. */
  teammateSpeaking: string | null;
  /** The teammates on the call muted, until they answer; for their tiles. */
  teammateMuted: readonly string[];
  /**
   * Skye brings something up herself, offering `proposal`: raised on a call
   * (in her own words, steered by `cue` when given), and a yes (said or
   * typed) carries it out. Resolves true as she is heard raising it, false
   * when she is not (see LiveCallController.offer).
   */
  offer: (said: string, proposal: AppAction, cue?: string) => Promise<boolean>;
  /** The caller's microphone while a call holds it. For level meters only. */
  localStream: MediaStream | null;
  /** The agent's audio while a call is up. For level meters only; playback is handled here. */
  remoteStream: MediaStream | null;
  /** Read-only RMS of existing streams; sampled imperatively by the background. */
  voiceLevel: (speaker: "user" | "agent") => number;
};

/** The current or most recent call's transcript, as speaker turns. */
export type LiveTranscript = {
  /** Which call the turns belong to, starting at 1; 0 before the first call. */
  call: number;
  turns: readonly TranscriptTurn[];
};

const LiveCallContext = React.createContext<LiveCallValue | null>(null);
// Separate from the call context: transcript deltas arrive many times a
// second, and only a view of the conversation should re-render for them.
const LiveTranscriptContext = React.createContext<LiveTranscript | null>(null);

/** Browser-backed transport for one call. */
function createBrowserTransport(handlers: TransportHandlers): LiveTransport {
  return new LiveTransport(
    {
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      // No ICE servers configured: Mica's broker and the session negotiate
      // directly, and adding third-party STUN/TURN is a deployment decision,
      // not something to assume here.
      createPeerConnection: () => new RTCPeerConnection(),
      requestSession: (sdp, signal) => requestLiveSession(sdp, { signal }),
    },
    handlers,
  );
}

/** The silence teammates' sessions hear: one source, each session a copy of it. */
let silence: MediaStream | null = null;

/**
 * Silence for a microphone, rendered: a tone at no volume. A destination with
 * nothing playing into it sends no audio at all, and a session that gets
 * none never gets round to what it is told.
 */
function silentMicrophone(): MediaStream {
  if (!silence) {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const volume = context.createGain();
    volume.gain.value = 0;
    const destination = context.createMediaStreamDestination();
    tone.connect(volume).connect(destination);
    tone.start();
    silence = destination.stream;
  }
  return silence.clone();
}

/**
 * Browser-backed transport for a teammate's session, as `persona`: his
 * microphone is silence, so he hears nobody, the user included.
 */
function createTeammateTransport(persona: LivePersona, handlers: TransportHandlers): LiveTransport {
  return new LiveTransport(
    {
      getUserMedia: async () => silentMicrophone(),
      createPeerConnection: () => new RTCPeerConnection(),
      requestSession: (sdp, signal) => requestLiveSession(sdp, { signal, persona }),
    },
    handlers,
  );
}

const hasSelection = (selection: { occupancyIds: readonly string[]; flightId: string | null }) =>
  selection.occupancyIds.length > 0 || selection.flightId !== null;

/** How long Skye's cursor rests on its last click before going back into the orb, ms. */
const HOME_AFTER_MS = 900;

/**
 * Once a task's clicks are done, Skye's cursor goes back into the orb, so
 * every task starts from the orb. Not when the task was cancelled or
 * superseded (the next one carries on from where the cursor is), nor when
 * another gesture has started meanwhile; one that starts on the way back
 * turns it round.
 */
function homeAfterTask(signal: AbortSignal): void {
  if (signal.aborted) return;
  setTimeout(() => {
    if (agentCursor.out && !agentCursor.active) void agentCursor.recall();
  }, HOME_AFTER_MS);
}

export function LiveCallProvider({ children }: { children: React.ReactNode }) {
  const operations = useOperations();
  const meterRef = React.useRef<VoiceMeter | null>(null);
  if (!meterRef.current) meterRef.current = new VoiceMeter();

  // The executor reads state when it runs, not when it was created, so the
  // host reads through a ref that every render refreshes.
  const operationsRef = React.useRef(operations);
  operationsRef.current = operations;

  // A monotonic revision for the board. Bumped whenever anything a voice
  // request can see or change is different, so a plan made against an older
  // revision can be recognised as stale.
  const revisionRef = React.useRef(0);
  const signature = React.useMemo(
    () =>
      JSON.stringify([
        operations.view,
        operations.filters,
        operations.selection.flightId,
        operations.selection.occupancyIds,
        // A stand move or swap changes what a request can see.
        operations.allocationVersion,
        [...operations.acknowledged].sort(),
      ]),
    [operations.view, operations.filters, operations.selection, operations.allocationVersion, operations.acknowledged],
  );
  const lastSignatureRef = React.useRef(signature);
  if (lastSignatureRef.current !== signature) {
    lastSignatureRef.current = signature;
    revisionRef.current += 1;
  }

  // Playback element for the agent's audio. Created once, outside React's
  // tree, so re-renders never interrupt audio.
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [audioBlocked, setAudioBlocked] = React.useState(false);
  const getAudio = React.useCallback(() => {
    if (!audioRef.current) {
      const element = new Audio();
      element.autoplay = true;
      audioRef.current = element;
    }
    return audioRef.current;
  }, []);

  /**
   * Starts playback and reports failure instead of swallowing it. A rejected
   * play() means a connected call the user cannot hear, which has to be
   * visible and recoverable rather than silent.
   */
  const playAudio = React.useCallback(
    (element: HTMLAudioElement) =>
      element
        .play()
        .then(() => setAudioBlocked(false))
        .catch(() => setAudioBlocked(true)),
    [],
  );

  const resumeAudio = React.useCallback(() => {
    meterRef.current?.wake();
    const element = audioRef.current;
    if (element?.srcObject) void playAudio(element);
  }, [playAudio]);

  // Exposed for level meters only. The transport keeps ownership of both.
  const [localStream, setLocalStream] = React.useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = React.useState<MediaStream | null>(null);

  const controllerRef = React.useRef<LiveCallController | null>(null);
  if (!controllerRef.current) {
    const host: OperationsHost = {
      snapshot: (): OpsSnapshot =>
        buildSnapshot({
          revision: revisionRef.current,
          view: operationsRef.current.view,
          filters: operationsRef.current.filters,
          acknowledged: operationsRef.current.acknowledged,
          // What "that flight" means: the user's selection, or Skye's when they have none.
          selection: hasSelection(operationsRef.current.selection)
            ? operationsRef.current.selection
            : operationsRef.current.skyeSelection,
        }),
      selectFlight: (flightId) => {
        const flight = OPS_FLIGHTS_BY_ID.get(flightId);
        // Re-checked here as well: the executor validated it, but this is the
        // boundary where it becomes a real UI change.
        if (!flight) return;
        // Sourced as "list", as a click in the flight list is: the flight's
        // bar on its stand, or in the No stand lane while it has none.
        operationsRef.current.actAsSkye(() => operationsRef.current.selectFlight(flight, "list"));
      },
      selectFlights: (flightIds, mode) => {
        const flights = flightIds.flatMap((id) => OPS_FLIGHTS_BY_ID.get(id) ?? []);
        if (flights.length > 0) operationsRef.current.actAsSkye(() => operationsRef.current.selectFlights(flights, mode));
      },
      // Asked for, so both: the user's selection and Skye's.
      clearSelection: () => {
        operationsRef.current.clearSelection();
        operationsRef.current.actAsSkye(() => operationsRef.current.clearSelection());
      },
      setView: (view) => operationsRef.current.setView(view),
      setFilter: (dimension, values) => operationsRef.current.setFilter(dimension, values),
      resetFilters: () => operationsRef.current.resetFilters(),
      setAcknowledged: (alertId, value) => operationsRef.current.setAcknowledged(alertId, value),
      applyStandPlan: (plan) => {
        operationsRef.current.actAsSkye(() => operationsRef.current.applyStandPlan(plan));
      },
      closeArea: (closure, plans, highlightIds) => {
        operationsRef.current.actAsSkye(() => operationsRef.current.closeArea(closure, plans, highlightIds));
      },
      assignStands: (assigns) => {
        operationsRef.current.actAsSkye(() => operationsRef.current.assignStands(assigns));
      },
      unassignStands: (stayIds) => {
        operationsRef.current.actAsSkye(() => operationsRef.current.unassignStands(stayIds));
      },
      applyFixes: (plans, assigns, highlightIds) => {
        operationsRef.current.actAsSkye(() => operationsRef.current.applyFixes(plans, assigns, highlightIds));
      },
      showAlerts: (mentioned) => showSkyeAlerts(mentioned),
      hideAlerts: () => hideSkyeAlerts(),
      // The People button's call (see ./callGuests), as its controls do.
      addToCall: (person) => inviteToCall(person),
      removeFromCall: (person) => removeGuest(person),
      // Skye's cursor acts the change out on screen; it lands at the click.
      // Closing an area, or placing several flights one after another, those
      // drops land quietly rather than each selecting its stay; the apply
      // then shows them all.
      gesture: async (action, signal) => {
        try {
          await (action.name === "close_area" ||
          action.name === "fix_all" ||
          action.name === "resolve_disruption" ||
          (action.name === "assign_stands" && action.assigns.length > 1)
            ? operationsRef.current.runSkyeBatch(() => playAgentGesture(action, signal))
            : playAgentGesture(action, signal));
        } finally {
          homeAfterTask(signal);
        }
      },
      // What Skye changes on the board waits there for approval: the
      // teammates whose area it touches, then the user (OutputsApproval);
      // each piece is listed in the Outputs panel meanwhile. Taking up the
      // disruption, however she was asked (its Run, a yes said or typed),
      // puts its notice away as she starts.
      beginChange: (action) => {
        if (action.name === "resolve_disruption") markDisruptionRunning();
        return beginSkyeChange(action);
      },
    };

    controllerRef.current = new LiveCallController({
      host,
      createTransport: createBrowserTransport,
      // Backend interpretation is the operational path. Phrase matching is
      // only used when explicitly asked for, so an unconfigured or failing
      // interpreter is reported rather than silently downgraded. The one
      // exception is the multi-cursor demo's request, matched first so it
      // always plays (see withDemoShortcuts).
      interpreter: withDemoShortcuts(resolveInterpreter(import.meta.env?.VITE_MICA_INTERPRETER, phraseInterpreter)),
      onRemoteStream: (stream) => {
        const element = getAudio();
        element.srcObject = stream;
        if (stream) void playAudio(element);
        else setAudioBlocked(false);
        setRemoteStream(stream);
        meterRef.current?.setOutput(stream);
      },
      onLocalStream: (stream) => {
        setLocalStream(stream);
        meterRef.current?.setInput(stream);
      },
      outputLevel: () => meterRef.current?.output() ?? 0,
      onLog: (entry: ExecutorLogEntry) => {
        // A failed gesture is a warning: the change then lands unanimated.
        if (entry.outcome === "gesture_failed") console.warn("[mica-live]", entry.outcome, entry.detail);
        else if (import.meta.env?.DEV) console.debug("[mica-live]", entry.outcome, entry.detail);
      },
    });
  }
  const controller = controllerRef.current;

  // A teammate's voice, answering Skye on an approval call, played on its own
  // element, so it never takes over hers, and metered on its own, to tell
  // when he has said his piece.
  const teammateAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const teammateMeterRef = React.useRef<VoiceMeter | null>(null);
  const teammateRef = React.useRef<TeammateVoice | null>(null);
  if (!teammateRef.current) {
    teammateMeterRef.current = new VoiceMeter();
    teammateRef.current = new TeammateVoice({
      createTransport: createTeammateTransport,
      play: (stream) => {
        if (!teammateAudioRef.current) {
          teammateAudioRef.current = new Audio();
          teammateAudioRef.current.autoplay = true;
        }
        const element = teammateAudioRef.current;
        element.srcObject = stream;
        // Skye's call already had its gesture; should it still be refused, he
        // goes unheard, and the approval goes on without his voice.
        if (stream) void element.play().catch(() => undefined);
        teammateMeterRef.current?.wake();
        teammateMeterRef.current?.setOutput(stream);
      },
      level: () => teammateMeterRef.current?.output() ?? 0,
    });
  }
  const teammate = teammateRef.current;

  // A teammate with a voice of their own, asked to approve while on the call
  // with Skye, answers her aloud (see skyeReview's askForSignoffs). Their
  // voice goes as they leave the call, or as Skye's call ends.
  React.useEffect(() => {
    // He picks up muted, and comes off mute as he answers.
    setAnswerAloud(
      (name) => controller.getState().phase === "connected" && guestNames().includes(name) && teammate.pickUp(name),
    );
    const unsubscribeGuests = subscribeCallGuests(() => {
      for (const name of teammate.names()) if (!guestNames().includes(name)) teammate.leave(name);
    });
    const unsubscribeCall = controller.subscribe(() => {
      if (controller.getState().phase !== "connected") teammate.leaveAll();
    });
    return () => {
      setAnswerAloud(null);
      unsubscribeGuests();
      unsubscribeCall();
      teammate.leaveAll();
    };
  }, [controller, teammate]);

  const state = React.useSyncExternalStore(
    React.useCallback((listener) => controller.subscribe(listener), [controller]),
    React.useCallback(() => controller.getState(), [controller]),
  );
  const teammateSpeaking = React.useSyncExternalStore(teammate.subscribe, teammate.speaking);
  const teammateMuted = React.useSyncExternalStore(teammate.subscribe, teammate.muted);

  React.useEffect(() => {
    if (state.phase === "idle" || state.phase === "failed") meterRef.current?.dispose();
  }, [state.phase]);

  // Hand-made board changes re-sync context (debounced in the executor).
  React.useEffect(() => {
    controller.noteContextChange(revisionRef.current);
  }, [controller, signature]);

  // Releasing the microphone matters more than keeping a call alive across an
  // unmount, so hang up rather than leaving a live session behind.
  React.useEffect(() => {
    const element = audioRef.current;
    return () => {
      void controller.hangup();
      meterRef.current?.dispose();
      if (element) element.srcObject = null;
    };
  }, [controller]);

  const startCall = React.useCallback(() => {
    // The existing Call button supplies the gesture; no extra permission or
    // autoplay flow is introduced. The meter never connects to the speakers.
    meterRef.current?.wake();
    void controller.start();
  }, [controller]);
  const hangup = React.useCallback(() => void controller.hangup(), [controller]);
  const setMuted = React.useCallback((muted: boolean) => void controller.setMuted(muted), [controller]);
  const runTypedRequest = React.useCallback((text: string) => controller.runTypedRequest(text), [controller]);
  const cancelTypedRequest = React.useCallback(() => void controller.cancelTypedRequest(), [controller]);
  const say = React.useCallback((text: string) => controller.say(text), [controller]);
  const speak = React.useCallback(
    (text: string, onWords?: (said: string) => void, ended?: (said: string) => boolean) =>
      controller.speak(text, onWords, ended),
    [controller],
  );
  const teammateReady = React.useCallback((name: string) => teammate.ready(name), [teammate]);
  const teammateAnswers = React.useCallback(
    async (name: string, cue: string, ended?: (said: string) => boolean, context?: string) => {
      // Skye stops listening while he talks, so his words, from the
      // speakers, are not taken for the caller's.
      controller.holdInput(true);
      try {
        return await teammate.answer(name, cue, ended, context);
      } finally {
        controller.holdInput(false);
      }
    },
    [controller, teammate],
  );
  const offer = React.useCallback(
    (said: string, proposal: AppAction, cue?: string) => controller.offer(said, proposal, cue),
    [controller],
  );
  const voiceLevel = React.useCallback((speaker: "user" | "agent") => {
    const current = controller.getState();
    if (current.phase !== "connected") return 0;
    if (speaker === "agent") return meterRef.current?.output() ?? 0;
    return current.muted ? 0 : (meterRef.current?.input() ?? 0);
  }, [controller]);

  // Read as one snapshot per change; the turns are rebuilt only when notified.
  const transcriptRef = React.useRef<LiveTranscript>({ call: 0, turns: [] });
  const transcript = React.useSyncExternalStore(
    React.useCallback(
      (listener) =>
        controller.subscribeTranscript(() => {
          transcriptRef.current = { call: controller.callNumber, turns: controller.transcript.turns() };
          listener();
        }),
      [controller],
    ),
    () => transcriptRef.current,
  );

  const value = React.useMemo<LiveCallValue>(
    () => ({
      state,
      active: state.phase !== "idle" && state.phase !== "failed",
      startCall,
      hangup,
      setMuted,
      audioBlocked,
      resumeAudio,
      runTypedRequest,
      cancelTypedRequest,
      say,
      speak,
      teammateReady,
      teammateAnswers,
      teammateSpeaking,
      teammateMuted,
      offer,
      localStream,
      remoteStream,
      voiceLevel,
    }),
    [
      state,
      startCall,
      hangup,
      setMuted,
      audioBlocked,
      resumeAudio,
      runTypedRequest,
      cancelTypedRequest,
      say,
      speak,
      teammateReady,
      teammateAnswers,
      teammateSpeaking,
      teammateMuted,
      offer,
      localStream,
      remoteStream,
      voiceLevel,
    ],
  );

  return (
    <LiveCallContext.Provider value={value}>
      <LiveTranscriptContext.Provider value={transcript}>{children}</LiveTranscriptContext.Provider>
    </LiveCallContext.Provider>
  );
}

/** The call transcript as speaker turns. Re-renders on every transcript change. */
export function useLiveTranscript(): LiveTranscript {
  const value = React.useContext(LiveTranscriptContext);
  if (!value) throw new Error("useLiveTranscript must be used inside <LiveCallProvider>");
  return value;
}

export function useLiveCall(): LiveCallValue {
  const value = React.useContext(LiveCallContext);
  if (!value) throw new Error("useLiveCall must be used inside <LiveCallProvider>");
  return value;
}
