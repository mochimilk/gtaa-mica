import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Chat, resolveTaskMessages, useChatContext } from "@coral-ai/chat";
import { useCoralAuth } from "@coral-ai/react";
import { Button } from "@fluentui/react-components";
import {
  ArrowUp20Filled,
  bundleIcon,
  Mic20Filled,
  ShareScreenStop20Filled,
  ShareScreenStop20Regular,
  Stop20Filled,
} from "@fluentui/react-icons";
import { agentCursor } from "../agent-cursor";
import { gtaaOpal, LiveOrb, skyeOrbStill } from "../orb";
import { StepStatusIcon } from "../step-status-icon";
import { AskButton } from "./AskButton";
import { AskWaveform } from "./AskWaveform";

/** Service indicator: red when unavailable, neutral when configured but unverified, green once a call connected. */
export type AskServiceStatus = "disconnected" | "configured" | "verified";

const STATUS_LABEL: Record<AskServiceStatus, string> = {
  disconnected: "Skye's service is not available",
  configured: "Skye's service is configured, not yet verified",
  verified: "Skye's voice service connected",
};

/**
 * Voice controls. VelmAI dictated one turn at a time; Mica's voice is a
 * GPT-Live session, so the bar shows that session instead. Mute and Disconnect
 * sit outside the input, at the app bar's end (see MuteButton and
 * DisconnectButton).
 */
export interface AskVoice {
  /** A call exists (starting, connecting, connected or ending); the voice bar shows. */
  onCall: boolean;
  muted: boolean;
  /** Recent call audio levels from 0 to 1, oldest first. */
  levels?: readonly number[];
  /** The caller's microphone while on a call; the orb reacts to it. */
  micStream?: MediaStream | null;
  /** Connects to the agent. */
  onStart: () => void;
}

export interface AskInputProps {
  agentName: string;
  /** Pill text and draft placeholder. */
  placeholder: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sends the draft; the chat is already open, as the draft is only there. */
  onSubmit: () => void;
  /** Stops the reply being written. */
  onStop: () => void;
  status?: AskServiceStatus;
  /** Skye is working out a reply: the orb becomes the thinking dots. */
  thinking?: boolean;
  /**
   * Skye's work was cut off rather than finished (a reply stopped, the call
   * ended): when it stops thinking, the orb comes back without a check.
   */
  stopped?: boolean;
  voice: AskVoice;
}

// Regular at rest, filled on hover/press, as Fluent buttons expect.
const RecallIcon = bundleIcon(ShareScreenStop20Filled, ShareScreenStop20Regular);

/** Whether Skye's cursor is out in the app, so it can be called back. */
const useCursorOut = () => useSyncExternalStore(agentCursor.subscribe, () => agentCursor.out);

type PartOfDay = "morning" | "afternoon" | "evening";

/** By the device's clock: morning from 5, afternoon from 12, evening from 18 and through the night. */
function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

/** The part of the day, checked again each minute: the app stays open from one into the next. */
function usePartOfDay(): PartOfDay {
  const [part, setPart] = useState(() => partOfDay(new Date().getHours()));
  useEffect(() => {
    const timer = window.setInterval(() => setPart(partOfDay(new Date().getHours())), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return part;
}

/**
 * "Good morning, Eunsoo": the part of the day, then the signed-in user's
 * first name, from Coral's auth (as the user card shows it). Without a name,
 * signed out or no auth at all, a plain "Good morning".
 */
function useGreeting(): string {
  const auth = useCoralAuth();
  const part = usePartOfDay();
  const name = auth?.status === "signed-in" ? auth.user?.name?.trim().split(/\s+/)[0] : undefined;
  return name ? `Good ${part}, ${name}` : `Good ${part}`;
}

/**
 * Calls Skye's cursor back into the orb. It fills the orb's place while the
 * cursor is out: after its first click the cursor stays where it was, and
 * carries on from there, until this brings it home.
 */
function RecallButton({ agentName }: { agentName: string }) {
  const out = useCursorOut();
  if (!out) return null;
  const label = `Bring ${agentName}'s cursor back`;
  // Inverse, like Send: dark on light, white in dark mode.
  return (
    <AskButton
      shape="circular"
      icon={RecallIcon}
      label={label}
      className="mica-ask__recall"
      onClick={() => void agentCursor.recall()}
    />
  );
}

/** Draft grows with its text up to this height, then scrolls. */
const MAX_DRAFT_HEIGHT = 120;

/** What the orb's place shows: the orb, the thinking dots, or the check they close into. */
type OrbPhase = "orb" | "thinking" | "done";

/** The check shows this long, ms: the dots' 875ms close into it (StepStatusIcon), then a beat to be seen. */
const DONE_MS = 1_500;

/**
 * The orb's place follows Skye's thinking: the dots while it works, then the
 * check once it has finished, then the orb again. No check when the work was
 * cut off (`stopped`), nor when the dots had left as Skye's cursor, which
 * comes back into the orb. Kept here, above the orb, so the check outlives
 * the input changing shape.
 */
function useOrbPhase(thinking: boolean, stopped: boolean, cursorOut: boolean): OrbPhase {
  const [wasThinking, setWasThinking] = useState(thinking);
  const [done, setDone] = useState(false);
  if (thinking !== wasThinking) {
    setWasThinking(thinking);
    setDone(!thinking && !stopped && !cursorOut);
  }
  useEffect(() => {
    if (!done) return undefined;
    const timer = window.setTimeout(() => setDone(false), DONE_MS);
    return () => window.clearTimeout(timer);
  }, [done]);
  return thinking ? "thinking" : done ? "done" : "orb";
}

/**
 * The thinking dots, shown in the orb's place while Skye works out a reply:
 * Luma's step spinner, which closes into a check when Skye finishes. It stays
 * one icon from dots to check, so the one morphs into the other. Skye's
 * cursor takes over from the dots, in step, when it leaves the orb
 * (`data-agent-spinner`). The orb's label says what it shows.
 */
function ThinkingIcon({ done }: { done: boolean }) {
  return (
    <span className="mica-ask__thinking-icon" data-agent-spinner={done ? undefined : ""} aria-hidden>
      <StepStatusIcon status={done ? "done" : "in-progress"} />
    </span>
  );
}

/**
 * Skye's orb, in place of a status dot; it greys out while the service is
 * unavailable, speeds up and glows brighter while the caller speaks, and
 * becomes the thinking dots while Skye works out a reply, which close into a
 * check when it has finished. It is also home to Skye's cursor, which leaves
 * the orb as a dot to click through the app and comes back into it. While the
 * cursor is out, the button that brings it back fills the orb's place.
 */
function AgentOrb({
  agentName,
  status,
  voice,
  phase,
}: {
  agentName: string;
  status?: AskServiceStatus;
  voice?: MediaStream | null;
  phase: OrbPhase;
}) {
  const out = useCursorOut();
  const label =
    phase === "thinking"
      ? "Skye is thinking"
      : phase === "done"
        ? "Skye has finished"
        : status
          ? STATUS_LABEL[status]
          : undefined;
  const slot = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => agentCursor.setHome(slot.current), []);
  if (out) {
    return (
      <span ref={slot} className="mica-ask__orb" data-recall>
        <RecallButton agentName={agentName} />
      </span>
    );
  }
  return (
    <span ref={slot} className="mica-ask__orb" data-status={status} role={label ? "img" : undefined} aria-label={label} title={label}>
      {phase !== "orb" ? (
        <ThinkingIcon done={phase === "done"} />
      ) : (
        <LiveOrb size={32} glow voice={voice} state="thinking" preset="opal" palette={gtaaOpal} still={skyeOrbStill} />
      )}
    </span>
  );
}

/**
 * Coral's cycling thinking words ("Thinking", "Analyzing", …), typed out with
 * a blinking cursor. The chat hides Coral's own copy under the messages; this
 * one sits in the input, where the placeholder would be. Its spinner is
 * hidden: the orb's thinking dots stand in for it.
 */
function ThinkingText() {
  const { isRetrying, streamingStatus, thinkingStatus } = useChatContext();
  return (
    <span className="mica-ask__thinking-text" aria-hidden>
      <Chat.ThinkingIndicator
        isRetrying={isRetrying}
        status={thinkingStatus}
        messages={resolveTaskMessages(streamingStatus)}
      />
    </span>
  );
}

/**
 * The composer, from VelmAI. Idle it is one button, the orb and a greeting
 * ("Good morning, Eunsoo"), that places a call; nothing in it opens the chat, which is
 * the toggle beside it (see AskSkye). Open it is the draft with Send or the
 * mic, and Stop beside them while a reply is being written. On a call it
 * becomes the voice bar: the orb and the waveform; Disconnect is at the app
 * bar's end. The orb always leads, standing in for Skye's state. Enter sends,
 * Shift+Enter adds a line, Escape minimizes.
 *
 * The draft, sending and the streaming state are Coral's chat context; only
 * the controls are VelmAI's.
 */
export function AskInput({
  agentName,
  placeholder,
  open,
  onOpenChange,
  onSubmit,
  onStop,
  status,
  thinking = false,
  stopped = false,
  voice,
}: AskInputProps) {
  const { input: draft, setInput: setDraft, isTyping: streaming, setInputHeight } = useChatContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { onCall } = voice;
  const cursorOut = useCursorOut();
  const phase = useOrbPhase(thinking, stopped, cursorOut);
  const greeting = useGreeting();
  const previous = useRef({ open, onCall });

  // Focus follows the controls that replace the ones just pressed: the draft
  // when the chat opens. When the voice bar appears, Disconnect at the app
  // bar's end takes it (see DisconnectButton). Minimizing is left to the chat
  // toggle beside the bar (see AskSkye).
  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = { open, onCall };
    if (was.open === open && was.onCall === onCall) return;
    if (!onCall && open) textareaRef.current?.focus();
  }, [open, onCall]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_DRAFT_HEIGHT)}px`;
  }, [draft, open, onCall]);

  // Coral places its scroll-to-bottom button above the input by this height.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const observer = new ResizeObserver(() => setInputHeight(root.offsetHeight));
    observer.observe(root);
    return () => observer.disconnect();
  }, [setInputHeight, open, onCall]);

  // A reply may still be streaming: the user can type over it, and sending
  // starts the new request, which supersedes the old one.
  const submit = () => {
    if (!draft.trim()) return;
    onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  if (onCall) {
    return (
      <div ref={rootRef} className="mica-ask__input" data-variant="voice">
        <AgentOrb agentName={agentName} status={status} voice={voice.micStream} phase={phase} />
        <AskWaveform levels={voice.levels} />
        <span className="mica-ask__visually-hidden" role="status">
          {`Connected to ${agentName}${voice.muted ? ", microphone muted" : ""}`}
        </span>
      </div>
    );
  }

  // Idle, the whole pill is the button that calls Skye. It greets the user;
  // its name starts with the greeting, so it can be asked for by what it says.
  if (!open) {
    return (
      <div ref={rootRef} className="mica-ask__input" data-variant="idle">
        {/* While the cursor is out, its recall button holds the orb's place
            just outside Connect: a button cannot hold another. */}
        {cursorOut && <AgentOrb agentName={agentName} status={status} voice={voice.micStream} phase={phase} />}
        <button
          type="button"
          className="mica-ask__connect"
          aria-label={`${greeting}. Connect to ${agentName}`}
          onClick={voice.onStart}
        >
          {!cursorOut && <AgentOrb agentName={agentName} status={status} voice={voice.micStream} phase={phase} />}
          {thinking ? <ThinkingText /> : <span className="mica-ask__connect-label">{greeting}</span>}
        </button>
      </div>
    );
  }

  // Fluent's own subtle circular button, at its medium 32px: the orb's size, as the composer's other controls are.
  const micLabel = `Connect to ${agentName}`;
  const mic = (
    <Button
      shape="circular"
      appearance="subtle"
      icon={<Mic20Filled />}
      aria-label={micLabel}
      title={micLabel}
      onClick={voice.onStart}
    />
  );

  const send = (
    <AskButton
      shape="circular"
      icon={ArrowUp20Filled}
      label="Send message"
      className="mica-ask__send"
      disabled={!draft.trim()}
      onClick={submit}
    />
  );
  // What starts the next turn: Send for a draft, otherwise the mic. While a
  // reply streams it stays beside Stop, so a new question, typed or spoken,
  // can cut in without stopping first.
  const next = draft.trim() ? send : mic;
  // The thinking words take the placeholder's place, and give way to a draft.
  const showThinking = thinking && !draft;

  return (
    <div ref={rootRef} className="mica-ask__input" data-variant="composer">
      <AgentOrb agentName={agentName} status={status} voice={voice.micStream} phase={phase} />
      <div className="mica-ask__field">
        <textarea
          ref={textareaRef}
          className="mica-ask__draft"
          rows={1}
          value={draft}
          placeholder={showThinking ? "" : placeholder}
          aria-label={`Message ${agentName}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {showThinking && <ThinkingText />}
      </div>
      <div className="mica-ask__actions">
        {streaming && (
          <AskButton
            shape="circular"
            appearance={next ? "secondary" : "primary"}
            icon={Stop20Filled}
            label="Stop response"
            onClick={onStop}
          />
        )}
        {next}
      </div>
    </div>
  );
}
