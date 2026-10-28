# Disruption demo: Skye catches a late arrival

> **DEV NOTE — demo staging.** Skye "catching" the disruption is staged: the
> news lands when you connect to Skye, because the prototype has no flight
> feed. That is one setting to change; see
> [When the news arrives](#when-the-news-arrives-walking-it-back).

Scenario 1 of the demo script, *Disruption resolution*: a late-arriving
flight, caught live. Skye says what happened and why, weighs it across the
plan, moves what the late flight runs into, and brings in the baggage lead.
The user approves, and the result is measured and logged.

## Running it

1. `npm run dev` (and `npm run dev:voice` for voice; see
   [gpt-live-voice.md](gpt-live-voice.md)). The board starts clear: no
   conflicts, nobody waiting for a stand.
2. Connect to Skye (the call button on the Ask Skye pill). About 4.5 seconds
   after the call is up, the news lands. Without voice, press **Ctrl+Alt+D**
   instead.
3. Press **Run** on the notice above Ask Skye. On a call you can also say
   "go ahead".
4. When Skye offers to call Travis, say or type "yes", or press **Review
   with baggage** on the approval card at the board's top right.
5. Once Travis approves (about 15 seconds: 5 to pick up, then 10 to look),
   press **Approve**.

To run it again, reload the page. The news lands once per page load.

## The beats

| Script beat | What the audience sees | Where |
| --- | --- | --- |
| Catch the disruption, with the why | XD472's bar on B11 shifts to its new ETA, its red ghost runs into the two arrivals behind it, and a notice pops up above Ask Skye with **Why**, **Conflict**, **Action**, **Run** and **Dismiss**. On a call Skye says it too, and offers to work it. Off a call, the heads-up goes into the chat. | `DisruptionNotice.tsx`, `disruption.ts` |
| Skye evaluates it across the plan | Skye frames B11 and rests on XD472 ("1h 50m late"). Then she splits into her echoes, who fan out at once. They visit each aircraft that would wait (how long), each stand she tries and why it won't do ("B12 · taken by XD456/457", "B14 · narrowbody only"), and the one that will ("A3 · free ✓"). They also sweep the stays around it ("clear"). Her ring fills: "Weighing XD472/473 · 16/28 checked". Then they stop on the four held aircraft ("Conflict · waits 1h 40m"), with "4 aircraft would wait · 5h 45m gate hold" on Skye. | `resolveDisruption` in `agentGestures.ts` |
| Skye proposes modifications | The helpers drag XC344/345 to A3 (Pier A) and XB232/233 to B10. XD472 keeps B11. The three stays stay outlined in Skye's colours. | same, then `crewWork` |
| User dives into impact | The Outputs peek lists each move as it lands (the activity log); the A3 move carries a **Baggage** badge. **Stop** on the Ask pill stops her mid-way, and **Undo** puts it all back. A new **Gate hold** KPI goes from 5h 45m to None (↓ 5h 45m vs plan), and Conflicts drops from 1 to 0. **Follow-up:** ask "why not move XD472 instead?" or "what's the impact?" and Skye explains why the late aircraft keeps its stand and what the plan does to gate hold and stand use. | `KpiStrip.tsx`, `boardKpis.ts` (`gateHolds`), `explainPlan` |
| Skye calls in the baggage lead | Skye's reply ends with "Want me to give Travis a call?", and a yes calls him. When he picks up, Skye briefs him on his part only: "XC344/345 moves from B11 to A3, 11:50–12:55, so its bags go to Pier A instead of Pier B…". She says it on a call, or writes it in the chat. He approves after 10 seconds. | `teammateBrief`, `useSkyeSpeaksUp` |
| Plan approved, impact shown | **Approve** turns the notice into **Plan approved**. It shows Baseline → Now for gate hold, conflicts and stand use, against the board as the news arrived, plus who approved it and when. The same decision is logged under the request in Outputs (**View log** opens it), and Skye says so. | `settleDisruption`, `OutputsPanel.tsx` (`DecisionLog`) |

## The scenario

| | |
| --- | --- |
| Late flight | XD472/473, B789 from London Heathrow, on B11. Scheduled 08:40–11:40; it is 1h 50m late in and the turn keeps its length, so it is now 10:30–13:30. Cause: "Held at origin for a late inbound crew". All of it lives in `DISRUPTION` in `src/operations/disruption.ts`. |
| Knock-on | It runs into XC344/345 (B788, due 11:50) and XB232/233 (B738, 13:05). Because each of those then leaves late, XC336/337 (14:00) and XA109/110 (15:45) wait too: 4 aircraft, 5h 45m of gate hold in all. |
| Skye's plan | Move what it runs into, not the late aircraft (already inbound, and a widebody tow mid-turn). Same pier first, then nearest by row, with no new conflict anywhere. The B788 has no widebody stand free on Pier B, so it goes to A3 and its bags move pier. The B738 goes to B10, on the same pier. |
| Fixture changes | The board now starts conflict-free. XA103/104's delay off A1 is 15m (was 55m) and XA107/108's onto A4 is 30m (was 60m). B11's day was reworked for the scenario: T24–T26 were added, and XA109/110 moved to 15:45. |

**Gate hold**, the new KPI, is minutes aircraft would wait for their stand.
On each stand in turn, an aircraft gets on when it is due or when the one
before it leaves, whichever is later. So it counts the knock-on that a
conflict (one ghost into the next stay) does not.

The news is *news, not a change*. `setRunningLate` in `allocation.ts` folds
the delay into the plan, so Reset stands and Undo keep it, and it is never
listed as anyone's change in Outputs.

## When the news arrives: walking it back

`src/operations/disruptionTrigger.ts` is the only place that decides:

```ts
export const DISRUPTION_TRIGGER: DisruptionTrigger = { on: "connect", afterMs: 4_500 };
```

- `"connect"`: lands a few seconds after a call to Skye connects (the default).
- `"load"`: lands `afterMs` after the page opens, call or no call. This is
  closest to a real feed: Skye is watching whether or not you're talking to her.
- `"manual"`: only Ctrl+Alt+D.

Ctrl+Alt+D works whichever you choose. While Skye is mid-change, the news
waits until she's done.

## How it's wired

| Piece | Where |
| --- | --- |
| The news landing, notice words, the plan, the "why", Travis's briefing, the result | `src/operations/disruption.ts` |
| The notice and result card, and Skye speaking up (heads-up, briefing, result) | `src/operations/DisruptionNotice.tsx`, `disruptionNotice.css` |
| `resolve_disruption` (write) and `explain_plan` (read) | `src/live/appActions.ts`; also in the backend interpreter's list (`server/interpret.mjs`) |
| Deterministic phrasing, as for the pier closure ("resolve XD472's late arrival", "why not move XD472?") | `matchDisruptionRequest` and `withDemoShortcuts` in `src/live/requestInterpreter.ts` |
| Skye saying something unasked on a call | `LiveCallController.say` and `offer`. It uses the instructions channel, as the greeting does. |
| What she says off a call, in the chat, in order | `src/components/ask-skye/skyeNotes.ts` |
| The notices slot above the Ask bar, and `useAskRun` | `AskSkye.tsx` (`notices` prop, through `AppNavbar`'s `askNotices`) |
| Decision log on approval | `approveSkyeChanges` in `skyeReview.ts`, `logDecision` in `outputs.ts` |

`fix_all` and the one-at-a-time "next up" now plan a late stay that runs into
several stays the same way, so "start my day" and Run never disagree about
moving XD472.

## Not done yet: to talk through

- **Live voice is unverified for the new speech.** On a call, the heads-up,
  the Run reply and Travis's briefing are sent as `session.instructions.append`
  (as `GREETING_INSTRUCTIONS` is). The tests cover the flow, but nobody has
  heard it on a real call yet.
- **Travis is still a timer.** He approves 10 seconds after he's asked. He
  doesn't speak, and there is no side-by-side compare view for him.
- **Off a call, Skye's replies go to the chat**, which stays closed unless
  you open it (Ctrl+K). The board and the approval card carry the story either
  way.
- **After Dismiss** the notice is gone for good. The conflict stays in Alerts,
  and asking Skye to "resolve the disruption" still works.
- **"Capacity"** in the script is shown as Stand use and Stand time. The plan
  takes stand use from 47% to 48%, because the two moved stays now take stand
  time of their own.
