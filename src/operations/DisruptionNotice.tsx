// Skye catching the day's disruption (./disruption), right above Ask Skye:
// the news, why, what it runs into and what is needed, with Run (Skye works
// it: resolve_disruption, sent as the user would ask) and Dismiss. Once her
// plan for it is approved, the same place shows what the plan did against
// the board as the news arrived, and that the decision is logged.
//
// It also does what Skye says unasked around it, aloud on a call and in the
// chat otherwise (see postSkyeNote): the heads-up as the news arrives, kept
// as her offer so a yes carries it out; a briefing for each teammate she
// calls in to approve, as they pick up; and the result once approved.
//
// When the news arrives is the demo's choice: see ./disruptionTrigger.
import { useCallback, useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { eventBus } from "@coral-ai/react";
import { Button } from "@fluentui/react-components";
import { ArrowRight16Regular, Checkmark16Regular, Play16Filled } from "@fluentui/react-icons";
import { postSkyeNote, useAskRun } from "../components/ask-skye";
import { skyeOrbStill } from "../components/orb";
import { useLiveCall, type LiveCallValue } from "../live";
import { validateAppAction } from "../live/appActions";
import {
  closeDisruptionResult,
  dismissDisruptionNotice,
  disruptionNotice,
  disruptionState,
  formatHold,
  headsUp,
  landDisruption,
  markDisruptionRunning,
  settleDisruption,
  settledLine,
  subscribeDisruption,
  teammateBrief,
  DISRUPTION,
} from "./disruption";
import { useDisruptionTrigger } from "./disruptionTrigger";
import { useOpsBoard } from "./OperationsContext";
import { OPS_FLIGHTS_BY_ID } from "./operationsData";
import { describeApprovers, formatLogTime } from "./outputs";
import { OUTPUTS_PANEL_ID } from "./OutputsPanel";
import { skyeReview, subscribeApprovals, subscribeSkyeReview } from "./skyeReview";
import "./disruptionNotice.css";

/** Says `text` on a call, or posts it in the chat when there is none. */
function tell(live: LiveCallValue, text: string, note = text): void {
  if (!live.say(text)) postSkyeNote(note);
}

/**
 * Skye's unasked words around the disruption: the heads-up when it lands, a
 * briefing for each teammate she calls in as they pick up, and the result
 * once her plan is approved.
 */
function useSkyeSpeaksUp(live: LiveCallValue): () => void {
  const liveRef = useRef(live);
  liveRef.current = live;

  const land = useCallback(() => {
    if (!landDisruption()) return;
    const said = headsUp();
    const proposal = validateAppAction("resolve_disruption", {});
    if (!said || !proposal.ok) return;
    const onCall = liveRef.current.state.phase === "connected";
    // Kept as her offer either way, so "go ahead" carries it out.
    liveRef.current.offer(said, proposal.action);
    if (!onCall) postSkyeNote(said.replace(/^Heads-up:/, "**Heads-up:**"));
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
          const brief = teammateBrief(signoff.name, current.changes);
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

  return land;
}

/** The disruption's notice and, once her plan is approved, its result; nothing otherwise. */
export function DisruptionNotice() {
  const live = useLiveCall();
  const run = useAskRun();
  const state = useSyncExternalStore(subscribeDisruption, disruptionState);
  // Read on every stand change, so the words follow the board.
  const { allocationVersion } = useOpsBoard();
  const words = useMemo(() => disruptionNotice(), [allocationVersion, state]);
  const land = useSkyeSpeaksUp(live);
  useDisruptionTrigger(live.state.phase, live.state.working, land);
  const titleId = useId();

  if (state.notice === "shown" && words) {
    const flight = OPS_FLIGHTS_BY_ID.get(DISRUPTION.flightId)?.flight ?? "the late flight";
    const onRun = () => {
      markDisruptionRunning();
      run?.(`Resolve ${flight}'s late arrival`);
    };
    return (
      <section className="mica-ask__notice skye-notice" aria-labelledby={titleId} data-skye-notice="disruption">
        <header className="skye-notice__eyebrow">
          <img src={skyeOrbStill} alt="" className="skye-notice__orb" />
          <span>Skye caught a disruption</span>
          <span className="skye-notice__when">Live update</span>
        </header>
        <h2 id={titleId} className="skye-notice__title" aria-live="polite">
          {words.title}
        </h2>
        <dl className="skye-notice__facts">
          <dt>Why</dt>
          <dd>{words.context}</dd>
          <dt>Conflict</dt>
          <dd>{words.conflict}</dd>
          <dt>Action</dt>
          <dd>{words.action}</dd>
        </dl>
        <div className="skye-notice__actions">
          <Button appearance="subtle" onClick={dismissDisruptionNotice}>
            Dismiss
          </Button>
          <Button appearance="primary" className="skye-notice__run" icon={<Play16Filled />} onClick={onRun} disabled={!run}>
            Run
          </Button>
        </div>
      </section>
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
    return (
      <section className="mica-ask__notice skye-notice" aria-labelledby={titleId} data-skye-notice="approved">
        <header className="skye-notice__eyebrow">
          <img src={skyeOrbStill} alt="" className="skye-notice__orb" />
          <span>Plan approved</span>
          <span className="skye-notice__when">Logged {formatLogTime(decision.at)}</span>
        </header>
        <h2 id={titleId} className="skye-notice__title" aria-live="polite">
          Disruption cleared
        </h2>
        <table className="skye-notice__impact">
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
        <p className="skye-notice__by">
          <Checkmark16Regular aria-hidden /> Approved by {describeApprovers(decision.by)}. The decision is in Outputs.
        </p>
        <div className="skye-notice__actions">
          <Button appearance="subtle" onClick={() => eventBus.setActivePanel(OUTPUTS_PANEL_ID)}>
            View log
          </Button>
          <Button appearance="primary" className="skye-notice__run" onClick={closeDisruptionResult}>
            Done
          </Button>
        </div>
      </section>
    );
  }

  return null;
}
