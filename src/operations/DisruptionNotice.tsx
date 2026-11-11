// Skye catching the day's disruption (./disruption), right above Ask Skye, as
// her notification (SkyeNotification): a Conflict pill with the news in a
// line, Review (Skye works it: resolve_disruption, sent as the user would ask)
// and Dismiss. Opened, it shows the stretch of the board in conflict
// (BoardSnippet), why, how its turn comes to run as long as it does, what it
// runs into, and each thing on that stand with its hours and part in it. Once
// her plan for it is approved, the same place shows what was applied, what the
// plan did against the board as the news arrived, and that the decision is
// logged.
//
// DisruptionWatch does what Skye says unasked around it, aloud on a call and
// in the chat otherwise (see postSkyeNote): the heads-up as the news arrives,
// kept as her offer so a yes carries it out; a briefing for each teammate she
// calls in to approve, as they pick up (aloud in briefAloud: the user greets
// Travis, she briefs him, he asks her one thing, approves, and stays on until
// the user approves too, then says goodbye; in writing in briefInWriting);
// and the result once approved. What is said goes on the written record too
// (./activity), so it can be caught up on without the audio.
//
// When the news arrives is the demo's choice: see ./disruptionTrigger.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { eventBus } from "@coral-ai/react";
import { ArrowRight16Regular, Checkmark16Regular } from "@fluentui/react-icons";
import { postSkyeNote, useAskRun } from "../components/ask-skye";
import { SkyeNotification } from "../components/skye-notification";
import { useLiveCall, type LiveCallValue } from "../live";
import { validateAppAction } from "../live/appActions";
import {
  farewell,
  goodbyesSaid,
  guestNames,
  leaveCall,
  stayForGoodbye,
  staysForGoodbye,
  subscribeCallGuests,
} from "../live/callGuests";
import { logActivity } from "./activity";
import { MINUTE } from "../stand-timeline";
import { BoardSnippet } from "../stand-timeline-demo/BoardSnippet";
import { DEMO_DATA, formatUtc } from "../stand-timeline-demo/demoData";
import { useDrawings } from "../studio/drawings";
import { occupancyById } from "./allocation";
import {
  announceDisruption,
  appliedSummary,
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
  reviewAgenda,
  runsInto,
  settleDisruption,
  settledLine,
  subscribeDisruption,
  teammateBrief,
  teammateBriefScript,
  teammateContext,
  teammateCue,
  teammateCueEnded,
  teammateFollowUp,
  teammateGoodbyeCue,
  teammateGoodbyeEnded,
  teammateQuestionCue,
  teammateQuestionEnded,
  DISRUPTION,
  type StandSegment,
} from "./disruption";
import { walkThrough } from "../approvals/walkThrough";
import { useDisruptionTrigger } from "./disruptionTrigger";
import { useGoldenPath } from "./goldenPath";
import { useOpsActions, useOpsBoard } from "./OperationsContext";
import { OPS_FLIGHTS_BY_ID } from "./operationsData";
import { describeApprovers, formatLogTime } from "./outputs";
import { OUTPUTS_PANEL_ID } from "./OutputsPanel";
import {
  approveSignoff,
  readyForUser,
  setSignoffExchange,
  setSignoffStage,
  signoffAsked,
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
const HANG_UP_AFTER_MS = 1_000;

/**
 * How far into SIGNOFF_MS a teammate with no voice of their own asks their
 * question, is answered, and is left to decide, ms: long enough to read each,
 * as each is a sentence.
 */
const QUESTION_AFTER_MS = 3_000;
const ANSWER_AFTER_MS = 5_500;
const DECIDING_AFTER_MS = 8_500;

/** The brief, for the record: what was put to them, not each word of it. */
function logBrief(name: string, current: SkyeReview): void {
  const agenda = reviewAgenda({
    moves: current.changes.length,
    forBaggage: current.changes.filter((change) => change.baggage).length,
    maintenance: !!current.maintenance,
  });
  logActivity("Skye", "said", `Briefed ${name}. ${agenda}`);
}

/**
 * The user's turn as a teammate picks up (hearCaller): they greet him and
 * hand over to Skye, who is not listening meanwhile. The shared screen says
 * he has joined; the presenter's next key hands over at once
 * (./goldenPath), as does anything that moves his sign-off on. Resolves
 * whether the user spoke.
 */
async function greetedBy(live: () => LiveCallValue, name: string): Promise<boolean> {
  setSignoffStage(name, "joined");
  const handedOver = new AbortController();
  const stop = subscribeSkyeReview(() => {
    if (skyeReview()?.signoffs.find((entry) => entry.name === name)?.stage !== "joined") handedOver.abort();
  });
  try {
    return await live().hearCaller(handedOver.signal);
  } finally {
    stop();
  }
}

/**
 * Resolves once a teammate staying on for the user (stayForGoodbye) is done
 * waiting: what he approved is decided (approved, and his goodbye is under
 * way; or cancelled), or he is off the call.
 */
function untilDecided(name: string): Promise<void> {
  return new Promise((resolve) => {
    const stops: (() => void)[] = [];
    const check = () => {
      if (skyeReview() && staysForGoodbye(name) && guestNames().includes(name)) return false;
      for (const stop of stops) stop();
      resolve();
      return true;
    };
    if (check()) return;
    stops.push(subscribeSkyeReview(check), subscribeCallGuests(check));
  });
}

/**
 * Skye briefs a teammate who answers her aloud (../live/teammateVoice), with
 * the user on the call too. As he picks up, the user greets him and hands
 * over to her (greetedBy): she then goes straight to the changes. She walks
 * him through the shared approval with her cursor as she says each thing
 * (../approvals/walkThrough). He picked up muted; once she has asked, he
 * comes off mute. With carousel maintenance moved, he asks her about it first
 * (teammateFollowUp), she answers, pointing at it, and that settles it. Then
 * he answers: it works, it's approved. Only that approves it: what he says on
 * the way does not. His session starts as she comes to her ask, and he is cued
 * as her last words arrive, so he answers without a long gap.
 *
 * If it is the user's to approve now, her cursor goes to the decision and he
 * stays on for them: they thank him and approve, Skye not listening
 * meanwhile, as none of it is said to her. As the plan is approved he says
 * goodbye and leaves (farewell, ../live/callGuests); cancelled, he just
 * leaves. Should someone else still have to approve, she thanks him, and he
 * hangs up as she does. He hears nobody: the user's greeting and thanks are
 * for the room, and his answers come from the app's cues. Should he not be
 * heard, she still answers what is on screen, and he approves and leaves all
 * the same. `live` is read at each step, as the call's value moves on.
 */
async function briefAloud(live: () => LiveCallValue, signoff: Signoff, current: SkyeReview): Promise<void> {
  const { name } = signoff;
  const introduced = await greetedBy(live, name);
  if (!signoffAsked(name)) return;
  const script = teammateBriefScript(name, current.changes, guestNames(), { introduced });
  const ask = script.beats.find((beat) => beat.kind === "ask")?.at ?? script.text.length;
  const walk = walkThrough(script, name);
  const context = teammateContext(current.changes) ?? undefined;
  const followUp = teammateFollowUp();
  setSignoffStage(name, "presenting");
  logBrief(name, current);
  let walking = true;
  const endWalk = () => {
    if (walking) walk.end();
    walking = false;
  };
  try {
    await live().speak(
      script.text,
      (said) => {
        walk.heard(said);
        if (walk.asked() || said.length >= ask) live().teammateReady(name);
      },
      walk.asked,
    );
    walk.said();
    if (followUp) {
      const { question, answer } = followUp;
      setSignoffStage(name, "asking");
      setSignoffExchange(name, { question });
      logActivity(name, "question", question);
      await live().teammateAnswers(name, teammateQuestionCue(question), teammateQuestionEnded, context);
      setSignoffStage(name, "answering");
      setSignoffExchange(name, { question, answer: answer.text });
      logActivity("Skye", "said", answer.text);
      walk.next(answer);
      await live().speak(answer.text, (said) => walk.heard(said));
      walk.said();
    }
    setSignoffStage(name, "deciding");
    await live().teammateAnswers(name, teammateCue(followUp?.answer.text), teammateCueEnded, context);
    approveSignoff(name);

    const next = skyeReview();
    if (!next || !readyForUser(next)) {
      let hangingUp: ReturnType<typeof setTimeout> | undefined;
      await live().speak(handOffLine(name, false), () => {
        hangingUp ??= setTimeout(() => leaveCall(name), HANG_UP_AFTER_MS);
      });
      if (!hangingUp) leaveCall(name);
      return;
    }
    walk.toDecision();
    live().holdInput(true);
    stayForGoodbye(name, () =>
      live().state.phase === "connected"
        ? live().teammateAnswers(name, teammateGoodbyeCue(), teammateGoodbyeEnded)
        : Promise.resolve(false),
    );
    await untilDecided(name);
    endWalk();
    // Cancelled, or the call is over: he goes without a word.
    if (staysForGoodbye(name)) leaveCall(name);
    await goodbyesSaid();
  } finally {
    endWalk();
    live().holdInput(false);
  }
}

/**
 * Skye briefs a teammate with no voice of their own, aloud on a call and in the
 * chat otherwise, and the rest is written on the shared screen, as it is in the
 * record: their question, her answer, then that it is theirs to decide. They
 * approve when skyeReview's SIGNOFF_MS is up; each step here is dropped should
 * they have decided, or the plan been cancelled, by then.
 */
function briefInWriting(live: () => LiveCallValue, signoff: Signoff, current: SkyeReview): void {
  const { name } = signoff;
  const brief = teammateBrief(name, current.changes, guestNames());
  setSignoffStage(name, "presenting");
  logBrief(name, current);
  tell(live(), brief, `**To ${name}:** ${brief}`);
  const at = (ms: number, then: () => void) =>
    setTimeout(() => {
      if (signoffAsked(name)) then();
    }, ms);
  const followUp = teammateFollowUp();
  if (followUp) {
    const { question, answer } = followUp;
    at(QUESTION_AFTER_MS, () => {
      setSignoffStage(name, "asking");
      setSignoffExchange(name, { question });
      logActivity(name, "question", question);
      postSkyeNote(`**${name}:** ${question}`);
    });
    at(ANSWER_AFTER_MS, () => {
      setSignoffStage(name, "answering");
      setSignoffExchange(name, { question, answer: answer.text });
      logActivity("Skye", "said", answer.text);
      tell(live(), answer.text, `**To ${name}:** ${answer.text}`);
    });
  }
  at(followUp ? DECIDING_AFTER_MS : QUESTION_AFTER_MS, () => setSignoffStage(name, "deciding"));
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
          briefInWriting(() => liveRef.current, signoff, current);
        }
      }),
    [],
  );

  // Approved: the result, shown as it settles the disruption, and said once
  // whoever stayed on the call for the user has said goodbye (farewell).
  useEffect(
    () =>
      subscribeApprovals((decision) => {
        if (!settleDisruption(decision)) return;
        const line = settledLine();
        if (line) void farewell().then(() => tell(liveRef.current, line));
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
  const cueNews = useDisruptionTrigger(live.state.phase, live.state.working, land, announce);
  // The presenter's key for the user's next step (./goldenPath), on every page.
  useGoldenPath(cueNews);
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

/** Each thing on the late stay's stand, in order: its flights, its hours there, and its part in it. */
function StandSegments({ segments, stand }: { segments: readonly StandSegment[]; stand: string }) {
  return (
    <table className="disruption-segments">
      <caption>On {stand}</caption>
      <tbody>
        {segments.map((segment) => (
          <tr key={segment.stayId} data-late={segment.late || undefined}>
            <th scope="row">{segment.name}</th>
            <td>{segment.times}</td>
            <td>{segment.purpose}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The disruption's notice and, once her plan is approved, its result; nothing otherwise. */
export function DisruptionNotice() {
  const run = useAskRun();
  const { actAsSkye, clearSelection } = useOpsActions();
  const state = useSyncExternalStore(subscribeDisruption, disruptionState);
  // Read on every stand change, so the words follow the board.
  const { allocationVersion } = useOpsBoard();
  const words = useMemo(() => disruptionNotice(), [allocationVersion, state]);

  if (state.notice === "shown" && words) {
    const flight = OPS_FLIGHTS_BY_ID.get(DISRUPTION.flightId)?.flight ?? "the late flight";
    const onReview = () => {
      markDisruptionRunning();
      run?.(`Resolve ${flight}'s late arrival`);
    };
    return (
      <SkyeNotification
        key="disruption"
        name="disruption"
        tone="danger"
        title="Conflict"
        summary={words.summary}
        action={{ label: "Review", onClick: onReview, disabled: !run }}
        onDismiss={dismissDisruptionNotice}
        preview={<LateStaySnippet stayId={DISRUPTION.stayId} />}
      >
        <p>{words.context}</p>
        <p>{words.turn}</p>
        <p>{words.conflict}</p>
        <StandSegments segments={words.segments} stand={occupancyById(DISRUPTION.stayId)?.rowId ?? ""} />
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
    // The moved stays stay outlined until the result is put away, so the plan's
    // outcome can be read off the board; then they go.
    const finish = () => {
      closeDisruptionResult();
      actAsSkye(() => clearSelection());
    };
    return (
      <SkyeNotification
        key="approved"
        name="disruption"
        tone="success"
        title="Disruption cleared"
        summary={`Applied · Gate hold ${gateHold.before} → ${gateHold.after} · Logged ${formatLogTime(decision.at)}`}
        action={{
          label: "Logs",
          appearance: "outline",
          onClick: () => {
            finish();
            eventBus.setActivePanel(OUTPUTS_PANEL_ID);
          },
        }}
        onDismiss={finish}
        dismissLabel="Done"
        preview={<LateStaySnippet stayId={DISRUPTION.stayId} />}
      >
        <p>{appliedSummary()}</p>
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
