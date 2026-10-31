import * as React from "react";
import { Chat, useChatContext, type ChatMessageRendererProps } from "@coral-ai/chat";
import { CoralMarkdown } from "@coral-ai/markdown";
import { PortalMountNodeProvider, ToggleButton, Tooltip } from "@fluentui/react-components";
import {
  bundleIcon,
  Dismiss20Regular,
  KeyboardFilled,
  KeyboardRegular,
  Speaker220Regular,
} from "@fluentui/react-icons";
import { createMicaAgentHandler } from "../agent-chat/micaAgentHandler";
import { useConnectChime, useSpeaking } from "../agent-call";
import {
  callFailureText,
  fetchLiveHealth,
  isRinging,
  subscribeVoiceKey,
  useLiveCall,
  useLiveTranscript,
  voiceKeyRevision,
} from "../../live";
import { KEEP_SELECTION_ATTR } from "../../operations/ViewsFiltersToolbar";
import { SkyeNotification } from "../skye-notification";
import { windowPortalNode } from "../window-layer";
import { AskButton } from "./AskButton";
import { AskFloatSlot } from "./AskFloatingWindow";
import { closeAskPanels, useAnyAskPanelOpen, useAskPanel } from "./askPanels";
import { AskInput, type AskServiceStatus } from "./AskInput";
import { mergeSkyeNotes, skyeNotes, subscribeSkyeNotes } from "./skyeNotes";
import { mergeVoiceTurns, VOICE_MESSAGE_TYPE } from "./voiceMessages";
import "./askSkye.css";

export type AskSkyeProps = {
  agentName: string;
  /**
   * Controls hung off the bar's end, right of Connect, as the chat toggle
   * hangs off its start. An AskFloatingWindow among them floats above the bar.
   */
  actionsEnd?: React.ReactNode;
  /**
   * What Skye brings up herself, stacked right above the bar (e.g.
   * DisruptionNotice). They can send Skye a request with useAskRun.
   */
  notices?: React.ReactNode;
};

/**
 * Sends Skye `text` as the user, as though typed in the chat: it shows in
 * the conversation with her reply, and on a call she also says the reply.
 */
export type AskRun = (text: string) => void;

const AskRunContext = React.createContext<AskRun | null>(null);

/** For a notice above the bar: sends Skye a request (see AskRun); null outside Ask Skye. */
export const useAskRun = (): AskRun | null => React.useContext(AskRunContext);

/** A turn Skye spoke on a call, drawn with Coral's markdown and marked as spoken. */
function SpokenReply({ message }: ChatMessageRendererProps) {
  return (
    <div className="mica-ask__spoken">
      <span className="mica-ask__spoken-label">
        <Speaker220Regular aria-hidden />
        Said on the call
      </span>
      <CoralMarkdown>{message.content}</CoralMarkdown>
    </div>
  );
}

const MESSAGE_COMPONENTS = { [VOICE_MESSAGE_TYPE]: SpokenReply };

// The chat toggle's icon: regular at rest, filled on hover and while the chat is open.
const ChatToggleIcon = bundleIcon(KeyboardFilled, KeyboardRegular);

/** How long after the connect chime starts the pill widens, ms. */
const WIDEN_AFTER_CHIME_MS = 500;
/** How long the pill takes to widen or narrow: askSkye.css's --durationSlower. */
const CALL_WIDTH_MS = 400;

/**
 * The pill's width for the call: "wide" from WIDEN_AFTER_CHIME_MS after the
 * connect chime starts until the call ends, then "narrowing" while it closes
 * back in round the orb, as gently as it opened (a chat closing narrows it
 * at the chat's own pace), then "narrow". The chime is the trigger: call the
 * returned function as it starts playing.
 */
type CallWidth = "narrow" | "wide" | "narrowing";

function useWidenAfterChime(onCall: boolean): [CallWidth, () => void] {
  const [width, setWidth] = React.useState<CallWidth>("narrow");
  const timer = React.useRef<number | undefined>(undefined);
  const onCallRef = React.useRef(onCall);
  onCallRef.current = onCall;

  const onChimePlaying = React.useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // The call may have failed or ended while the chime played.
      if (onCallRef.current) setWidth("wide");
    }, WIDEN_AFTER_CHIME_MS);
  }, []);

  React.useEffect(() => {
    if (onCall) return;
    window.clearTimeout(timer.current);
    setWidth((current) => (current === "wide" ? "narrowing" : "narrow"));
    timer.current = window.setTimeout(() => setWidth("narrow"), CALL_WIDTH_MS);
  }, [onCall]);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  return [width, onChimePlaying];
}

/**
 * Readiness of Mica's model service, from the broker's health route: red when
 * the broker is down or the interpreter or GPT-Live is not configured, neutral
 * when configured, green once a call has really connected on this page. It is
 * checked again whenever a call fails, and when Settings → API's key changes.
 */
function useServiceStatus(phase: string): AskServiceStatus | undefined {
  const [health, setHealth] = React.useState<AskServiceStatus | undefined>(undefined);
  const [verified, setVerified] = React.useState(false);
  const keyRevision = React.useSyncExternalStore(subscribeVoiceKey, voiceKeyRevision);

  React.useEffect(() => {
    if (phase === "connected") setVerified(true);
  }, [phase]);

  React.useEffect(() => {
    if (phase !== "idle" && phase !== "failed") return undefined;
    const aborter = new AbortController();
    void fetchLiveHealth({ signal: aborter.signal }).then((result) => {
      if (aborter.signal.aborted) return;
      const interpreter = (result as { interpreter?: { ready?: unknown } } | null)?.interpreter;
      setHealth(result?.ready && interpreter?.ready === true ? "configured" : "disconnected");
    });
    return () => aborter.abort();
  }, [phase, keyRevision]);

  if (health === "disconnected") return "disconnected";
  return verified ? "verified" : health;
}

function AskSurface({ agentName, actionsEnd, notices, speakNext }: AskSkyeProps & { speakNext: React.RefObject<boolean> }) {
  const chat = useChatContext();
  const live = useLiveCall();
  const transcript = useLiveTranscript();
  const notes = React.useSyncExternalStore(subscribeSkyeNotes, skyeNotes);
  const status = useServiceStatus(live.state.phase);
  // A chime as the call starts connecting; the ring is for calling people in.
  // The pill widens a beat after the chime starts, and closes back in as the call ends.
  const [callWidth, onChimePlaying] = useWidenAfterChime(live.active);
  useConnectChime(isRinging(live.state), onChimePlaying);
  // The chat, or a window floating above the bar: only one is open at a time.
  const [open, setOpen] = useAskPanel("chat");
  const anyOpen = useAnyAskPanelOpen();
  const [floatSlot, setFloatSlot] = React.useState<HTMLDivElement | null>(null);
  // The surface plus the windows and notice floating above it: pressing any
  // of it counts as being inside.
  const stackRef = React.useRef<HTMLDivElement>(null);
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const surfaceId = React.useId();
  const pendingSend = React.useRef(false);

  const { messages, setMessages, isTyping: streaming, input: draft } = chat;
  const onCall = live.active;
  const connected = live.state.phase === "connected";
  const failed = live.state.phase === "failed";
  const started = messages.some((message) => message.role !== "system");
  // Skye talking on the call, as the call window lights her tile.
  const { voiceLevel } = live;
  const agentSpeaking = useSpeaking(
    React.useCallback(() => voiceLevel("agent"), [voiceLevel]),
    connected,
  );

  // What was said on a call joins the conversation. Held back while Coral is
  // writing a typed reply, which replaces the whole list when it settles;
  // merging is idempotent, so the turns are put back once it has.
  React.useEffect(() => {
    if (streaming) return;
    setMessages((current) => mergeVoiceTurns(current, transcript.call, transcript.turns));
  }, [transcript, streaming, messages, setMessages]);
  // So do what Skye says unasked, held back and put back the same way.
  React.useEffect(() => {
    if (streaming) return;
    setMessages((current) => mergeSkyeNotes(current, notes));
  }, [notes, streaming, messages, setMessages]);

  const thinking = streaming || live.state.working;
  // A reply stopped (Stop, or a new message cutting in) is cut off rather
  // than finished, as is work the call ending cancels: the orb shows no check.
  const [stopped, setStopped] = React.useState(false);
  React.useEffect(() => {
    if (thinking) setStopped(false);
  }, [thinking]);

  const stop = React.useCallback(() => {
    setStopped(true);
    chat.shouldStopRef.current = true;
    chat.onStop?.();
  }, [chat]);

  // Sending while a reply is still being written stops that reply first, and
  // sends once Coral has settled it, so the two can never overwrite each other.
  const submit = () => {
    if (!draft.trim()) return;
    if (streaming) {
      pendingSend.current = true;
      stop();
      return;
    }
    void chat.sendMessage();
  };
  React.useEffect(() => {
    if (streaming || !pendingSend.current) return;
    pendingSend.current = false;
    if (draft.trim()) void chat.sendMessage();
  }, [streaming, draft, chat]);

  // A request from a notice above the bar, sent as the user would. One
  // under way is stopped first, as sending a typed message does.
  const pendingRun = React.useRef<string | null>(null);
  const run = React.useCallback<AskRun>(
    (text) => {
      if (streaming) {
        pendingRun.current = text;
        stop();
        return;
      }
      speakNext.current = live.state.phase === "connected";
      void chat.sendMessage(text);
    },
    [streaming, stop, chat, live.state.phase, speakNext],
  );
  React.useEffect(() => {
    if (streaming || pendingRun.current === null) return;
    const text = pendingRun.current;
    pendingRun.current = null;
    run(text);
  }, [streaming, run]);

  // Only the chat toggle (or Ctrl+K) opens the chat: placing a call, or one
  // failing, leaves it as it was. The failure's notice floats above the bar.
  const startVoice = () => live.startCall();

  // The sound notice, dismissed, stays away for the rest of that call.
  const [soundDismissed, setSoundDismissed] = React.useState(false);
  React.useEffect(() => {
    if (!onCall) setSoundDismissed(false);
  }, [onCall]);

  // Pressing anywhere outside the chat closes it to the pill, as it does a
  // floating window; the conversation and any draft stay. Only the user's own
  // presses count: Skye's cursor clicks the board with synthetic events while
  // the chat stays open. Menus the chat opens render in portals and count as
  // inside.
  React.useEffect(() => {
    if (!anyOpen) return undefined;
    const leave = (event: PointerEvent) => {
      const target = event.target;
      if (!event.isTrusted || !(target instanceof Element)) return;
      if (stackRef.current?.contains(target) || target.closest("[data-portal-node]")) return;
      closeAskPanels();
    };
    document.addEventListener("pointerdown", leave, true);
    return () => document.removeEventListener("pointerdown", leave, true);
  }, [anyOpen]);

  // Closing the chat from inside it (Escape, its close button) would drop
  // focus on the page; it goes to the toggle that reopens it instead.
  const wasOpen = React.useRef(open);
  React.useLayoutEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    const active = document.activeElement;
    if (!active || active === document.body) toggleRef.current?.focus();
  }, [open]);

  // Ctrl+K or Cmd+K opens the chat, or minimizes it when it is open. Unlike
  // VelmAI it never starts the microphone: placing a call stays a click.
  const openRef = React.useRef(open);
  openRef.current = open;
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.repeat || event.isComposing || document.querySelector("dialog:modal")) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(!openRef.current);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [setOpen]);

  // Connection news is Skye's notification too: its line cut short, the whole
  // of it in the details. Not hers to vouch for, so no AI disclaimer. No
  // claim that the board is unchanged: a call can drop after an action applied.
  const failureText = callFailureText(live.state) ?? "";
  const soundText = `Connected, but the browser has not let ${agentName} play sound yet.`;
  const notice = failed ? (
    <SkyeNotification
      key="call-failed"
      tone="danger"
      title="Connection error"
      summary={failureText}
      action={{ label: "Try again", onClick: startVoice }}
      onDismiss={live.hangup}
      dismissLabel="Dismiss connection error"
      disclaimer={null}
    >
      <p>{failureText}</p>
    </SkyeNotification>
  ) : onCall && live.audioBlocked && !soundDismissed ? (
    <SkyeNotification
      key="audio-blocked"
      tone="warning"
      icon={<Speaker220Regular />}
      title="No sound"
      summary={soundText}
      action={{ label: "Turn on sound", onClick: live.resumeAudio }}
      onDismiss={() => setSoundDismissed(true)}
      disclaimer={null}
    >
      <p>{soundText}</p>
    </SkyeNotification>
  ) : null;

  return (
    <AskFloatSlot.Provider value={floatSlot}>
      {/* With a window open the stack stands over Skye's cursors (askSkye.css); what opens from it, over it. */}
      <PortalMountNodeProvider value={windowPortalNode()}>
        <div ref={stackRef} className="mica-ask__stack">
          {/* An open AskFloatingWindow renders here, above the notice and the bar. */}
          <div ref={setFloatSlot} className="mica-ask__float-slot" />
          {/* What Skye brings up herself, then any connection notice, right above the bar. */}
          <AskRunContext.Provider value={run}>{notices}</AskRunContext.Provider>
          {notice}
          {/* The toggles hang off the bar's ends, so the bar stays centred in the dock. */}
          <div className="mica-ask__row">
            <div className="mica-ask__side" data-side="start">
              <Tooltip content="Keyboard" relationship="label">
                <ToggleButton
                  ref={toggleRef}
                  appearance="subtle"
                  checked={open}
                  icon={<ChatToggleIcon />}
                  aria-controls={surfaceId}
                  onClick={() => setOpen(!open)}
                />
              </Tooltip>
            </div>
            <section
              id={surfaceId}
              className="mica-ask__surface"
              data-open={open}
              // Open, it covers part of the board: Skye's cursors work around it (agentGestures.ts).
              data-agent-avoid={open ? "" : undefined}
              // Wide 0.5s after the connect chime starts, until the call ends; then narrowing.
              data-call-width={callWidth}
              data-empty={!started}
              data-streaming={streaming}
              aria-label={`Chat with ${agentName}`}
            >
              {/* Header and messages sit before the input so the input keeps its place, and its focus, across modes. */}
              {open && (
                <header className="mica-ask__header">
                  <div className="mica-ask__title">
                    <h2 className="mica-ask__title-name">{agentName}</h2>
                  </div>
                  <AskButton
                    shape="circular"
                    appearance="transparent"
                    icon={Dismiss20Regular}
                    label="Close chat"
                    onClick={() => setOpen(false)}
                  />
                </header>
              )}
              {open && (
                <div className="mica-ask__messages">
                  <Chat.Messages components={MESSAGE_COMPONENTS} />
                </div>
              )}
              <AskInput
                agentName={agentName}
                placeholder={`Ask ${agentName}`}
                open={open}
                onOpenChange={setOpen}
                onSubmit={submit}
                onStop={stop}
                status={status}
                thinking={thinking}
                stopped={stopped || live.state.phase === "closing" || failed}
                voice={{
                  onCall,
                  muted: live.state.muted,
                  agentStream: onCall ? live.remoteStream : null,
                  agentSpeaking,
                  onStart: startVoice,
                }}
              />
            </section>
            {actionsEnd && (
              <div className="mica-ask__side" data-side="end">
                {actionsEnd}
              </div>
            )}
          </div>
        </div>
      </PortalMountNodeProvider>
    </AskFloatSlot.Provider>
  );
}

/**
 * Ask Skye, in the navbar's center: VelmAI's conversational surface on Mica's
 * own model setup.
 *
 * Typed requests go through `runTypedRequest`, the same executor voice
 * requests use, with the interpreter route (`/api/live/interpret`), and voice
 * is the shared GPT-Live call from `LiveCallProvider`. Coral's
 * `Chat.Canvas` owns the conversation and `Chat.Messages` draws it; the input,
 * buttons and voice bar are VelmAI's.
 */
export function AskSkye({ agentName, actionsEnd, notices }: AskSkyeProps) {
  const { runTypedRequest, cancelTypedRequest, say } = useLiveCall();
  // Set for a request a notice sends on a call (see AskRun): Skye says that reply too.
  const speakNext = React.useRef(false);
  const onSendMessage = React.useMemo(
    () =>
      createMicaAgentHandler(async (text) => {
        const speak = speakNext.current;
        speakNext.current = false;
        const reply = await runTypedRequest(text);
        if (speak && reply) say(reply);
        return reply;
      }),
    [runTypedRequest, say],
  );
  return (
    // Talking to Skye must not drop the selection being talked about; see
    // ViewsFiltersToolbar for the marker.
    <div className="mica-ask" {...KEEP_SELECTION_ATTR}>
      <Chat.Canvas onSendMessage={onSendMessage} onStop={cancelTypedRequest}>
        <AskSurface agentName={agentName} actionsEnd={actionsEnd} notices={notices} speakNext={speakNext} />
      </Chat.Canvas>
    </div>
  );
}
