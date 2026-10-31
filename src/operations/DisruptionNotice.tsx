// Skye catching the day's disruption (./disruption), right above Ask Skye, as
// her notification (SkyeNotification): a Conflict pill with the news in a
// line, Plan (Skye works it: resolve_disruption, sent as the user would ask)
// and Dismiss. Opened, it shows the stretch of the board in conflict
// (BoardSnippet), why, and what it runs into. Once her plan for it is
// approved, the same place shows what the plan did against the board as the
// news arrived, and that the decision is logged.
//
// DisruptionWatch does what Skye says unasked around it, aloud on a call and
// in the chat otherwise (see postSkyeNote): the heads-up as the news arrives,
// kept as her offer so a yes carries it out; a briefing for each teammate she
// calls in to approve, as they pick up (Travis answers her aloud, approves and
// hangs up: briefAloud); and the result once approved.
//
// When the news arrives is the demo's choice: see ./disruptionTrigger.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { eventBus } from "@coral-ai/react";
import { ArrowRight16Regular, Checkmark16Regular } from "@fluentui/react-icons";
import { postSkyeNote, useAskRun } from "../components/ask-skye";
import { SkyeNotification } from "../components/skye-notification";
import { useLiveCall, type LiveCallValue } from "../live";
import { validateAppAction } from "../live/appActions";
import { guestNames, leaveCall } from "../live/callGuests";
import { MINUTE } from "../stand-timeline";
import { BoardSnippet } from "../stand-timeline-demo/BoardSnippet";
import { DEMO_DATA, formatUtc } from "../stand-timeline-demo/demoData";
import { useDrawings } from "../studio/drawings";
import { occupancyById } from "./allocation";
import {
  announceDisruption,
  closeDisruptionResult,
  dismissDisruptionNotice,
  disruptionNotice,
  disruptionState,
  formatHold,
  handOffLine,
  headsUp,
  headsUpCue,
  landDisruption,
  markDisruptionRunning,
  runsInto,
  settleDisruption,
  settledLine,
  subscribeDisruption,
  teammateBrief,
  teammateBriefScript,
  teammateContext,
  teammateCue,
  teammateCueEnded,
  DISRUPTION,
} from "./disruption";
import { walkThrough } from "../approvals/walkThrough";
import { useDisruptionTrigger } from "./disruptionTrigger";
import { useOpsBoard } from "./OperationsContext";
import { OPS_FLIGHTS_BY_ID } from "./operationsData";
import { describeApprovers, formatLogTime } from "./outputs";
import { OUTPUTS_PANEL_ID } from "./OutputsPanel";
import {
  approveSignoff,
  readyForUser,
  skyeReview,
  subscribeApprovals,
  subscribeSkyeReview,
  type Signoff,
  type SkyeReview,
} from "./skyeReview";
import "./disruptionNotice.css";

/** Says `text` on a call, or posts it in the chat when there is none. */
function tell(live: LiveCallValue, text: string, note = text): void {
  if (!live.say(text)) postSkyeNote(note);
}

/** Once she starts thanking him, how long before he hangs up, ms: he hears her out. */
const HANG_UP_AFTER_MS = 1_400;

/**
 * Skye briefs a teammate who answers her aloud (../live/teammateVoice),
 * walking him through the shared approval with her cursor as she says each
 * thing (../approvals/walkThrough). He picked up muted; once she has asked,
 * he comes off mute and answers: it works, it's approved, thanks, let me
 * know if you need anything else. His session
 * starts as she comes to her ask, and he is cued as her last words arrive,
 * so he answers without a long gap. Once he has come to the end of it, she
 * thanks him, he hangs up as she does, and, if it is theirs to approve now,
 * she hands it to the user, her cursor on the decision. He talks to Skye
 * alone: the user is not heard by him. Should he not be heard, he approves
 * and leaves all the same. `live` is read at each step, as the call's value
 * moves on.
 */
async function briefAloud(live: () => LiveCallValue, signoff: Signoff, current: SkyeReview): Promise<void> {
  const script = teammateBriefScript(signoff.name, current.changes, guestNames());
  const ask = script.beats.find((beat) => beat.kind === "ask")?.at ?? script.text.length;
  const walk = walkThrough(script, signoff.name);
  try {
    await live().speak(
      script.text,
      (said) => {
        walk.heard(said);
        if (walk.asked() || said.length >= ask) live().teammateReady(signoff.name);
      },
      walk.asked,
    );
    walk.said();
    await live().teammateAnswers(
      signoff.name,
      teammateCue(),
      teammateCueEnded,
      teammateContext(current.changes) ?? undefined,
    );
    approveSignoff(signoff.name);

    const next = skyeReview();
    const yours = !!next && readyForUser(next);
    if (yours) walk.toDecision();
    let hangingUp: ReturnType<typeof setTimeout> | undefined;
    await live().speak(handOffLine(signoff.name, yours), () => {
      hangingUp ??= setTimeout(() => leaveCall(signoff.name), HANG_UP_AFTER_MS);
    });
    if (!hangingUp) leaveCall(signoff.name);
  } finally {
    walk.end();
  }
}

/**
 * Skye's unasked words around the disruption: the heads-up once she spots it
 * on the board (`announce`, which shows the notice), a briefing for each
 * teammate she calls in as they pick up, and the result once her plan is
 * approved.
 */
function useSkyeSpeaksUp(live: LiveCallValue): () => void {
  const liveRef = useRef(live);
  liveRef.current = live;

  const announce = useCallback(() => {
    // Not when the user got to it first, asking Skye to resolve it.
    if (disruptionState().notice !== "none") return;
    const said = headsUp();
    const proposal = validateAppAction("resolve_disruption", {});
    if (!said || !proposal.ok) return;
    // Kept as her offer either way, so "go ahead" carries it out. On a call
    // she puts it in her own words, briefly (the notice has the details), and
    // the notice waits for her voice, so the two arrive together however long
    // she takes. Off a call, or if she isn't heard, her heads-up goes in the
    // chat as the notice shows.
    void liveRef.current.offer(said, proposal.action, headsUpCue() ?? undefined).then((heard) => {
      if (!announceDisruption()) return;
      if (!heard) postSkyeNote(said.replace(/^Heads-up:/, "**Heads-up:**"));
    });
  }, []);

  // Each teammate asked to approve her changes is briefed once, as they pick up.
  const briefed = useRef(new Set<string>());
  useEffect(
    () =>
      subscribeSkyeReview(() => {
        const current = skyeReview();
        if (!current) {
          briefed.current.clear();
          return;
        }
        for (const signoff of current.signoffs) {
          if (signoff.state !== "asked" || briefed.current.has(signoff.name)) continue;
          briefed.current.add(signoff.name);
          if (signoff.aloud) {
            void briefAloud(() => liveRef.current, signoff, current);
            continue;
          }
          const brief = teammateBrief(signoff.name, current.changes, guestNames());
          tell(liveRef.current, brief, `**To ${signoff.name}:** ${brief}`);
        }
      }),
    [],
  );

  // Approved: the result, said and shown, once it settles the disruption.
  useEffect(
    () =>
      subscribeApprovals((decision) => {
        if (!settleDisruption(decision)) return;
        const line = settledLine();
        if (line) tell(liveRef.current, line);
      }),
    [],
  );

  return announce;
}

/** Puts the news on the board; Skye spots it a moment later (./disruptionTrigger). */
const land = () => void landDisruption();

/**
 * The news landing (./disruptionTrigger) and Skye speaking up around it;
 * nothing on screen. Apart from the notice, as it goes on while the user is
 * away from the board: on the Chat page, Skye still briefs Travis, and
 * the result is still given once her plan is approved.
 */
export function DisruptionWatch() {
  const live = useLiveCall();
  const announce = useSkyeSpeaksUp(live);
  useDisruptionTrigger(live.state.phase, live.state.working, land, announce);
  return null;
}

const HALF_HOUR = 30 * MINUTE;
const QUARTER_HOUR = 15 * MINUTE;

/**
 * The late stay's stand and those either side of it, as the board has them
 * now: from half an hour before it is on its stand to a quarter after its
 * late turn and whatever it runs into, so its red ghost and the stays it
 * runs into are all in view.
 */
function LateStaySnippet({ stayId }: { stayId: string }) {
  const { allocationVersion, flightStyle } = useOpsBoard();
  const drawings = useDrawings();
  const view = useMemo(() => {
    const stay = occupancyById(stayId);
    const at = stay ? DEMO_DATA.rows.findIndex((row) => row.id === stay.rowId) : -1;
    if (!stay || at < 0) return null;
    const into = runsInto(stay.id);
    const from = Math.min(stay.start, ...into.map((other) => other.start)) - HALF_HOUR;
    const to = Math.max(stay.end + (DEMO_DATA.delays.get(stay.id)?.out ?? 0), ...into.map((other) => other.end)) + QUARTER_HOUR;
    const domain = [Math.floor(from / HALF_HOUR) * HALF_HOUR, Math.ceil(to / QUARTER_HOUR) * QUARTER_HOUR] as const;
    const rows = DEMO_DATA.rows.slice(Math.max(0, at - 1), at + 2);
    return {
      rows,
      domain,
      // A new array per stand change, so the snippet lays its bars out again.
      occupancies: [...DEMO_DATA.occupancies],
      label: `The board: stands ${rows[0].label} to ${rows.at(-1)?.label}, ${formatUtc(domain[0])} to ${formatUtc(domain[1])} UTC`,
    };
  }, [stayId, allocationVersion]);
  if (!view) return null;
  return (
    <BoardSnippet
      rows={view.rows}
      domain={view.domain}
      occupancies={view.occupancies}
      flightStyle={flightStyle}
      drawings={drawings}
      ariaLabel={view.label}
    />
  );
}

/** The disruption's notice and, once her plan is approved, its result; nothing otherwise. */
export function DisruptionNotice() {
  const run = useAskRun();
  const state = useSyncExternalStore(subscribeDisruption, disruptionState);
  // Read on every stand change, so the words follow the board.
  const { allocationVersion } = useOpsBoard();
  const words = useMemo(() => disruptionNotice(), [allocationVersion, state]);

  if (state.notice === "shown" && words) {
    const flight = OPS_FLIGHTS_BY_ID.get(DISRUPTION.flightId)?.flight ?? "the late flight";
    const onPlan = () => {
      markDisruptionRunning();
      run?.(`Resolve ${flight}'s late arrival`);
    };
    return (
      <SkyeNotification
        key="disruption"
        tone="danger"
        title="Conflict"
        summary={words.summary}
        action={{ label: "Plan", onClick: onPlan, disabled: !run }}
        onDismiss={dismissDisruptionNotice}
        preview={<LateStaySnippet stayId={DISRUPTION.stayId} />}
      >
        <p>{words.context}</p>
        <p>{words.conflict}</p>
      </SkyeNotification>
    );
  }

  if (state.notice === "approved" && state.approved) {
    const { decision, impact } = state.approved;
    // Against the board as the news arrived; green where it is better.
    const rows = [
      { label: "Gate hold", before: formatHold(impact.gateHold.before), after: formatHold(impact.gateHold.after), better: impact.gateHold.after < impact.gateHold.before },
      { label: "Conflicts", before: String(impact.conflicts.before), after: String(impact.conflicts.after), better: impact.conflicts.after < impact.conflicts.before },
      { label: "Stand use", before: `${impact.standUse.before}%`, after: `${impact.standUse.after}%`, better: false },
    ];
    const gateHold = rows[0];
    return (
      <SkyeNotification
        key="approved"
        tone="success"
        title="Disruption cleared"
        summary={`Gate hold ${gateHold.before} → ${gateHold.after} · Logged ${formatLogTime(decision.at)}`}
        action={{
          label: "Logs",
          appearance: "outline",
          onClick: () => {
            closeDisruptionResult();
            eventBus.setActivePanel(OUTPUTS_PANEL_ID);
          },
        }}
        onDismiss={closeDisruptionResult}
        dismissLabel="Done"
        preview={<LateStaySnippet stayId={DISRUPTION.stayId} />}
      >
        <table className="disruption-impact">
          <caption className="ops-visually-hidden">Against the plan as the disruption arrived</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="ops-visually-hidden">Figure</span>
              </th>
              <th scope="col">Baseline</th>
              <th scope="col" aria-hidden />
              <th scope="col">Now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.before}</td>
                <td aria-hidden>
                  <ArrowRight16Regular />
                </td>
                <td data-better={row.better || undefined}>{row.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="disruption-approved-by">
          <Checkmark16Regular aria-hidden /> Approved by {describeApprovers(decision.by)}. The decision is in Outputs.
        </p>
      </SkyeNotification>
    );
  }

  return null;
}
