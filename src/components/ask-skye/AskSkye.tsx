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
import { useConnectChime } from "../agent-call";
import { callFailureText, fetchLiveHealth, isRinging, useLiveCall, useLiveTranscript } from "../../live";
import { KEEP_SELECTION_ATTR } from "../../operations/ViewsFiltersToolbar";
import { windowPortalNode } from "../window-layer";
import { AskButton } from "./AskButton";
import { AskFloatSlot } from "./AskFloatingWindow";
import { closeAskPanels, useAnyAskPanelOpen, useAskPanel } from "./askPanels";
import { AskInput, type AskServiceStatus } from "./AskInput";
import { mergeSkyeNotes, skyeNotes, subscribeSkyeNotes } from "./skyeNotes";
import { useAudioLevels } from "./useAudioLevels";
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

/**
 * Readiness of Mica's model service, from the broker's health route: red when
 * the broker is down or the interpreter or GPT-Live is not configured, neutral
 * when configured, green once a call has really connected on this page. It is
 * checked again whenever a call fails.
 */
function useServiceStatus(phase: string): AskServiceStatus | undefined {
  const [health, setHealth] = React.useState<AskServiceStatus | undefined>(undefined);
  const [verified, setVerified] = React.useState(false);

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
  }, [phase]);

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
  useConnectChime(isRinging(live.state));
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
  const failed = live.state.phase === "failed";
  const started = messages.some((message) => message.role !== "system");
  const levels = useAudioLevels(onCall ? [live.localStream, live.remoteStream] : []);

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

  const notice = failed ? (
    <div className="mica-ask__notice" data-tone="error" role="alert">
      {/* No claim that the board is unchanged: a call can drop after an action applied. */}
      <p className="mica-ask__notice-text">{callFailureText(live.state)}</p>
      <AskButton size="small" appearance="primary" onClick={startVoice}>
        Try again
      </AskButton>
      <AskButton
        size="small"
        appearance="transparent"
        icon={Dismiss20Regular}
        label="Dismiss connection error"
        onClick={live.hangup}
      />
    </div>
  ) : onCall && live.audioBlocked ? (
    <div className="mica-ask__notice" role="alert">
      <p className="mica-ask__notice-text">Connected, but the browser has not let {agentName} play sound yet.</p>
      <AskButton size="small" appearance="primary" icon={Speaker220Regular} onClick={live.resumeAudio}>
        Turn on sound
      </AskButton>
    </div>
  ) : null;

  return (
    <AskFloatSlot.Provider value={floatSlot}>
      {/* With a window open the stack stands over Skye's cursors (askSkye.css); what opens from it, over it. */}
      <PortalMountNodeProvider value={windowPortalNode()}>
        <div ref={stackRef} className="mica-ask__stack">
          {/* An open AskFloatingWindow renders here, above the notice and the bar. */}
          <div ref={setFloatSlot} className="mica-ask__float-slot" />
          {/* What Skye brings up herself, right above the bar (and above a connection notice). */}
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
              data-empty={!started}
              data-listening={onCall}
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
                  levels,
                  micStream: onCall ? live.localStream : null,
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
