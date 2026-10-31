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
2. Connect to Skye (the call button on the Ask Skye pill). 3 seconds after
   the call is up, the news lands on the board. About a second later Skye
   speaks up, and her notification appears above Ask Skye as she starts
   talking. Without voice, press **Ctrl+Alt+D** instead.
3. Press **Plan** on the notification (click it first to see the stretch of
   the board in conflict and why). On a call you can also say "go ahead" or
   "let's take a look".
4. When Skye offers to call Travis, say or type "yes", or press **Review
   with baggage** on the approval card at the board's top right. Either one
   switches to the **Approvals** page.
5. Once Travis approves (about 15 seconds: 5 to pick up, then 10 to look),
   press **Approve plan** at the page's foot. **Stand planner** in the nav
   rail takes you back to the board, where the result is waiting.

To run it again, reload the page. The news lands once per page load.

## The beats

| Script beat | What the audience sees | Where |
| --- | --- | --- |
| Catch the disruption, with the why | XD472's bar on B11 shifts to its new ETA, and its red ghost runs into the two arrivals behind it. About a second later Skye's notification widens out above Ask Skye: a **Conflict** pill ("XD472 from LHR 1h 50m late") with **Plan** and dismiss. Clicked, it opens upward onto a snippet of the board (B10–B12, the late turn's red ghost breathing), why it's late, and what it runs into. On a call it waits for her voice, so the two arrive together: she gives a one-line heads-up in her own words, flight first, then where it's from, then what it's doing ("XD472 from London Heathrow is running late and causing conflicts, want to take a look?"), steered by `headsUpCue` rather than scripted; times and figures stay on the notification. Off a call, the same line goes into the chat as the notification shows. | `DisruptionNotice.tsx`, `SkyeNotification.tsx`, `BoardSnippet.tsx`, `disruption.ts` |
| Skye evaluates it across the plan | Skye frames B11 and rests on XD472 ("1h 50m late"). Then she splits into her echoes, who fan out at once. They visit each aircraft that would wait (how long), each stand she tries and why it won't do ("B12 · taken by XD456/457", "B14 · narrowbody only"), and the one that will ("A3 · free ✓"). They also sweep the stays around it ("clear"). As they float over the board they hover it as a pointer does: each bar they pass over lights up and its labels come up full, and a late stay's ghost shows its pill. Her ring fills: "Weighing XD472/473 · 16/28 checked". Then they stop on the five held aircraft ("Conflict · waits 3h 00m"), with "5 aircraft would wait · 13h 15m gate hold" on Skye. | `resolveDisruption` in `agentGestures.ts`; hovering in `cursorMotion.ts` |
| Skye proposes modifications | Four echoes, one for each flight XD472 runs into, all at once: XC344/345 to A3 and XC336/337 to A5 (Pier A), XB232/233 to B10 and XA117/118 to B14 (Pier B). XD472 keeps B11. The five stays stay outlined in Skye's colours. | same, then `crewWork` |
| User dives into impact | Skye says it in a line: "Done: XD472/473 keeps B11, and we've given the 4 flights behind it new stands. Gate hold is down from 13h 15m to none. Baggage operations in Terminal A approves first, then you. Want me to call them?" The Outputs peek lists each move as it lands (the activity log); the two Pier A moves carry a **Baggage** badge. **Stop** on the Ask pill stops her mid-way, and **Cancel** puts it all back. A new **Gate hold** KPI goes from 13h 15m to None, and Conflicts drops from 1 to 0. **Follow-up:** ask "why not move XD472 instead?" or "what's the impact?" and Skye explains why the late aircraft keeps its stand, names each move, and says what the plan does to gate hold and stand use. | `resolve_disruption` in `appActions.ts`, `KpiStrip.tsx`, `boardKpis.ts` (`gateHolds`), `explainPlan` |
| Skye calls in the baggage lead | A yes to "Want me to call them?" calls Travis, as **Review with baggage** does. The call opens on the **Chat** page: the request's title and Teams' meeting bar across the top (only the microphone and **Leave** work), the call's tiles under it (Travis ringing), then two panes. **Stand changes** lists all four moves as cards in the order of the day (XC344 · B11 → A3 · XC345), the first baggage has to approve picked. **Baggage carousels** opens on the day in figures (flights, bags, the busiest hour, carousels out of service, clashes), then shows what the picked move does to the bags, on the board's chart with carousels for rows. Every flight's bags are on it, spread over each pier's carousels, labelled with the flight, where it's from, and (given room) how many bags on what aircraft. Late flights' bags reach back to when they were due off, as ghosts, and carousels out of service are hatched ("Belt maintenance 12:00–13:30" on carousel 2). XC344's 239 bags were to come off carousel 4 (dashed), and now come off carousel 1, 12:00–12:35, where XD608's are until 12:15. Both are in red, with a **Conflict** tag. XC336's move to A5 is clear ("Bags move"); the two Pier B moves keep their carousels ("No change"). At the foot, **Cancel** and the decision, held at "Waiting for approval". When he picks up, Skye briefs him on his part only, a sentence a move: "XC344/345 moves from B11 to A3, 11:50–12:55, so its bags go to Pier A instead of Pier B. And XC336/337 moves from B11 to A5…". She says it on a call, or writes it in the chat. Answering aloud, he says it works, approves, thanks her, and "let me know if you need anything else". Otherwise he approves after 10 seconds. | `ApprovalsCall.tsx`, `CarouselTimeline.tsx`, `baggage.ts`, `baggageFixture.ts`, `teammateBrief`, `teammateCue`, `useSkyeSpeaksUp` |
| Plan approved, impact shown | **Approve plan** approves it: the foot reads "Approved by Travis Hughes and you", with the time, and the plan moves to **Decided** in the page's list. Skye says it in a line: "That's approved and logged. Gate hold is down from 13h 15m to none, with no conflicts left." Back on the board (**Stand planner** in the nav rail), the notification is now **Disruption cleared** ("Gate hold 13h 15m → none"). Opened, it shows the same stretch of the board, now clear, then Baseline → Now for gate hold, conflicts and stand use, against the board as the news arrived, plus who approved it. The same decision is logged under the request in Outputs (**Logs** opens it). | `settleDisruption`, `settledLine`, `OutputsPanel.tsx` (`DecisionLog`) |

## The scenario

| | |
| --- | --- |
| Late flight | XD472/473, B789 from London Heathrow, on B11. Scheduled 08:40–11:40; it is 1h 50m late in, and its crew, who take it back out, need their rest first, so it leaves 3h 10m late: it is now on B11 10:30–14:50. Cause: "Held at origin for a late inbound crew, who need their rest before taking it back out". All of it lives in `DISRUPTION` in `src/operations/disruption.ts`. |
| Knock-on | It runs into B11's bank of quick turns behind it: XC344/345 (B788, due 11:50), XB232/233 (B738, 13:05), XA117/118 (A320, 13:55) and XC336/337 (E195, 14:45). Because each of those then leaves late, XA109/110 (15:45) waits too: 5 aircraft, 13h 15m of gate hold in all. |
| Skye's plan | Move what it runs into, not the late aircraft (already inbound, and a widebody tow mid-turn). Same pier first, then nearest by row, with no new conflict anywhere. Four moves, each to a stand of its own: the B788 has no widebody stand free on Pier B, so it goes to A3; the B738 and A320 stay on Pier B (B10, B14); by the E195's turn Pier B is full, so it goes to A5. The two Pier A moves take their bags to another pier, so baggage approves them. |
| Fixture changes | The board starts conflict-free. XA103/104's delay off A1 is 15m (was 55m) and XA107/108's onto A4 is 30m (was 60m). B11's day was reworked for the scenario: T24–T27 were added and its bank tightened to quick turns (XB232/233 13:05–13:45, XC336/337 14:45–15:30). Pier B got a busier afternoon, so the moves spread out (T28 on B10, T29 on B16, T31 on B14, T32 on B15), all after 13:00, clear of the Pier B closure demo's window. |

**Gate hold**, the new KPI, is minutes aircraft would wait for their stand.
On each stand in turn, an aircraft gets on when it is due or when the one
before it leaves, whichever is later. So it counts the knock-on that a
conflict (one ghost into the next stay) does not.

The news is *news, not a change*. `setRunningLate` in `allocation.ts` folds
the delay into the plan, so Reset stands and Cancel keep it, and it is never
listed as anyone's change in Outputs.

## When the news arrives: walking it back

`src/operations/disruptionTrigger.ts` is the only place that decides:

```ts
export const DISRUPTION_TRIGGER: DisruptionTrigger = { on: "connect", afterMs: 3_000, noticeAfterMs: 1_000 };
```

- `"connect"`: lands `afterMs` after a call to Skye connects (the default).
- `"load"`: lands `afterMs` after the page opens, call or no call. This is
  closest to a real feed: Skye is watching whether or not you're talking to her.
- `"manual"`: only Ctrl+Alt+D.

Whichever you choose, the late flight and its conflict show on the board
first, and Skye speaks up `noticeAfterMs` later. On a call, the notification
waits for her voice: `LiveCallController.offer` lets her finish what she's
saying, sends the cue, and resolves when she's next heard (or after 8
seconds, when the heads-up also goes into the chat). The notification and
her voice arrive together however long the model takes.

Ctrl+Alt+D works whichever you choose. While Skye is mid-change, the news
waits until she's done.

## How it's wired

| Piece | Where |
| --- | --- |
| The news landing, notice words, the plan, the "why", Travis's briefing, the result | `src/operations/disruption.ts` |
| The notification and its result (`DisruptionNotice`, on the board only), and Skye speaking up: heads-up, briefing, result (`DisruptionWatch`, on the board and the Approvals page) | `src/operations/DisruptionNotice.tsx`, `disruptionNotice.css` |
| Skye's notification itself: the pill, opening onto its preview and details, its motion and glass | `src/components/skye-notification/` |
| The board snippet in it: the board's rows, ruler and bars, only to look at | `src/stand-timeline-demo/BoardSnippet.tsx` |
| The Approvals page: its list, the call tiles, the stand changes, the decision, and opening itself when Travis is brought in (`useOpenApprovals`) | `src/approvals/ApprovalsPage.tsx`, `src/approvals/approvalList.ts` |
| The baggage: carousels and the day's plan, made from the sample flights; each arrival's bags on the board now; what a move does to them (`bagMove`); the carousels chart | `src/stand-timeline-demo/baggageFixture.ts`, `src/operations/baggage.ts`, `src/approvals/CarouselTimeline.tsx` |
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
  the Run reply, Travis's briefing and Travis's own answer are sent as
  `session.commentary.append` (as the greeting is), the channel GPT-Live says
  aloud; they were instructions, which piled up for the rest of the call and
  could cut Skye off. The tests cover the flow, but nobody has heard the
  change on a real call yet.
- **Travis is still a timer.** He approves 10 seconds after he's asked, and
  he doesn't speak. His approval is not his to click: it lands on its own.
- **Nobody sorts out the carousel clash.** The Approvals page shows XC344's
  bags landing on carousel 1 while XD608's are there, and Travis approves
  anyway. Nothing moves bags to a free carousel (3 is free then), and
  nothing re-plans the carousels when stands change. Nor does anything sort
  out XD472's own late bags, which now land on XA626's on carousel 4 (the
  figures count both as clashes). The baggage data is a synthetic plan made
  from the sample flights (`baggageFixture.ts`): 12 carousels; each flight's
  checked bags by aircraft type, a little more or less flight to flight;
  first bag 10 minutes after on-block, then 7 bags a minute (20 minutes at
  least); three outages on the day; and each pier's flights spread over all
  its carousels. A flight moved to another pier goes to the new stand's
  nearest carousel.
- **The board starts over after the Approvals page.** Switching pages
  unmounts the board, as the Studio does, so coming back it is scrolled to
  the start of the day again, not where Skye left it.
- **Off a call, Skye's replies go to the chat**, which stays closed unless
  you open it (Ctrl+K). The board and the approval card carry the story either
  way.
- **After Dismiss** the notice is gone for good. The conflict stays in Alerts,
  and asking Skye to "resolve the disruption" still works.
- **"Capacity"** in the script is shown as Stand use and Stand time. The plan
  takes stand use from 49% to 50%, because the four moved stays now take
  stand time of their own.
