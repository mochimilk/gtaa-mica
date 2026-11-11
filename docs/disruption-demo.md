# Disruption demo: Skye catches a late arrival

> **DEV NOTE — demo staging.** Skye "catching" the disruption is staged: the
> news lands when the presenter cues it, because the prototype has no flight
> feed. That is one setting to change; see
> [When the news arrives](#when-the-news-arrives-walking-it-back).

Scenario 1 of the demo script, *Disruption resolution*: a late-arriving
flight, caught live. Skye says what happened and why, weighs it across the
plan, moves what the late flight runs into, and brings in the baggage lead.
The user approves, and the result is measured and logged. It is cut to run in
about 1:15: two moves (one on the same pier, one to another pier that brings
baggage and a carousel maintenance move in), short lines throughout, and
every step of the user's driven by the user.

## Running it: the golden path

Every step of the user's waits for the user, never a timer. Each can be done
three ways: the control on screen, a word to Skye on a call, or the
presenter's **next** key, **Ctrl+Alt+N** (or **PageDown**, which is what a
presentation clicker sends). The key presses the control on screen for you,
with a flash, so the audience sees it pressed; while it is Skye's or Travis's
turn it does nothing. See `src/operations/goldenPath.ts`.

1. `npm run dev` (and `npm run dev:voice` for voice; see
   [gpt-live-voice.md](gpt-live-voice.md)). The board starts clear: no
   conflicts, nobody waiting for a stand. Connect to Skye (the call button on
   the Ask Skye pill); she says hello.
2. **Cue the news** (next key, or Ctrl+Alt+D) when you have set the scene.
   XD472's late bar lands on B11; a moment later Skye speaks up and her
   notification appears above Ask Skye as she starts talking.
3. **Review** on the notification (click it first to see the stretch of the
   board in conflict and why), or say "go ahead". Skye's echoes show the
   problem, the stands she tries, then move the two flights (about 13s).
4. When Skye offers to call baggage, say "yes", or **Review with baggage**
   on the approval card. Her cursor goes to the Chat page, onto the channel,
   and presses its Call.
5. Travis picks up after 2.5 seconds ("Travis joined" on the agenda). On a
   call, **greet him and hand over**: "Hey Travis, Skye's moved a flight onto
   your carousels." Skye isn't listening while you say it, and briefs him as
   you stop, going straight to the changes (the next key hands over at once;
   say nothing for 4 seconds and she gives the whole brief, hello and news
   included). He asks Skye one question, and approves. **He stays on for
   you**: thank him ("Thanks Travis, I'll approve it now") and press
   **Approve plan** at the page's foot. He says goodbye and drops off, and you
   go back to the board, framed on what moved, where the result is waiting.
   Off a call, Skye briefs him in writing and he approves on a timer.
6. **Logs** on the result opens the record. The task pinned in the dock
   (**XD472/473 · 1h 50m late**) opens it at any point, on any page.

To run it again, reload the page. The news lands once per page load.

### Where the 1:15 goes

Measured with no voice in a 1600×1000 window; voice timings are estimates
from the length of each line.

| Beat | Who | About |
| --- | --- | --- |
| Hello, set the scene, cue the news | Presenter, Skye | 0:00–0:04 |
| Heads-up as the notification shows | Skye | 0:04–0:09 |
| Review | Presenter | 0:09–0:11 |
| The problem (5 held, 6h 35m), the stands she tries, two moves | Skye | 0:11–0:24 |
| "Done: … gate hold down to none. Baggage approves first. Want me to call them?" | Skye | 0:24–0:30 |
| Yes: her cursor places the call | Presenter, Skye | 0:30–0:35 |
| You greet Travis; her brief, his question, her answer, his approval; you thank him | Presenter, Skye, Travis | 0:37–1:04 |
| Approve plan; his goodbye; the result and "Approved and logged" | Presenter, Travis, Skye | 1:04–1:12 |

## The beats

| Script beat | What the audience sees | Where |
| --- | --- | --- |
| Catch the disruption, with the why | XD472's bar on B11 shifts to its new ETA, and its red ghost runs into the arrivals behind it. About a second later Skye's notification widens out above Ask Skye: a **Conflict** pill ("XD472 from LHR 1h 50m late") with **Review** and dismiss, and the task pins in the dock. Clicked, it opens upward onto a snippet of the board (B10–B12, the late turn's red ghost breathing), why it's late, when it now leaves (13:30, was 11:40), the two it runs into and the knock-on counted, and a line for each thing on B11: its flights, its hours and its part in it. On a call it waits for her voice, so the two arrive together: she gives a one-line heads-up in her own words, flight first, then where it's from, then what it's doing ("XD472 from London Heathrow is running late and causing conflicts, want to take a look?"), steered by `headsUpCue` rather than scripted; times and figures stay on the notification. Off a call, the same line goes into the chat as the notification shows. | `DisruptionNotice.tsx`, `SkyeNotification.tsx`, `BoardSnippet.tsx`, `disruption.ts` |
| Skye evaluates it across the plan | Skye frames B11 and rests beside XD472's bar. A smaller orb stays in the dock while she is out, with the button that brings her back over it on hover, and the task stays pinned beside it, not on her tag. Then, staying there, she splits into her echoes, in three quick beats. The problem: one on each aircraft that would wait ("Waits 1h 40m"), with "5 aircraft would wait · 6h 35m gate hold" on Skye. The search: the nearest stand she turns down for each kind of reason ("B10 · taken by XB216/217", "B14 · narrowbody only") and the ones that will do ("A3 · free ✓", "B10 · free ✓"), her ring filling: "Finding stands · 2/4 checked". Then the moves. As they float over the board they hover it as a pointer does: each bar they pass over lights up and its labels come up full, and a late stay's ghost shows its pill. About 13 seconds from Review to done. | `resolveDisruption` and `standChecks` in `agentGestures.ts`; hovering in `cursorMotion.ts` |
| Skye proposes modifications | Two moves, one for each flight XD472 runs into: XC344/345 to A3 (Pier A) and XB232/233 to B10 (Pier B). The echoes take what shows on the chart at once; what needs the chart scrolled (A3 is six rows from B11), Skye carries herself. XD472 keeps B11, and the three behind (XA117/118, XC336/337, XA109/110) keep it too, no longer held. The three stays stay outlined in Skye's colours. XC344's bags would land on XD608's on carousel 1, and Pier A has nothing else free (carousel 3's next bags are too close), so she also moves carousel 2's belt maintenance, 12:00–13:30 to 12:45–14:15, and gives XC344's bags its belt. | same, then `crewWork`; `planMaintenanceMove` in `baggage.ts` |
| User dives into impact | Skye says it in a line: "Done: XD472/473 keeps B11 and 2 flights move, so gate hold is down from 6h 35m to none. Baggage operations in Terminal A approves first, then you. Want me to call them?" The Outputs peek lists each move as it lands; the Pier A move and the maintenance carry a **Baggage** badge. **Stop** on the Ask pill stops her mid-way, and **Cancel** puts it all back. A new **Gate hold** KPI goes from 6h 35m to None, and Conflicts drops from 1 to 0. **Follow-up:** ask "why not move XD472 instead?" or "what's the impact?" and Skye explains why the late aircraft keeps its stand, names each move, and says what the plan does to gate hold and stand use. | `resolve_disruption` in `appActions.ts`, `KpiStrip.tsx`, `boardKpis.ts` (`gateHolds`), `explainPlan` |
| Skye calls in the baggage lead | A yes to "Want me to call them?" calls Travis, as **Review with baggage** does: Skye's cursor goes to **Chat** in the nav rail, onto **Baggage control A**, and beside its **Call**, which she presses, her tag saying "Calling Baggage control A". The call opens: the request's title and Teams' meeting bar across the top (only the microphone and **Leave** work), the call's tiles (Travis ringing), then the agenda: where it has got to, in one place throughout ("Calling Travis", "Skye is presenting changes", "Travis is asking Skye", "Skye is answering Travis", "Waiting for Travis", "Ready for your approval"), and "XD472 is 1h 50m late. Two stand changes are proposed; one requires baggage review, with one carousel maintenance move." Then two panes. **Proposed changes** lists each move as a card in the order of the day (XC344 · B11 → A3 · XC345), with its carousel, bags and hours under it (Carousel 4 → 2, 239 bags, 12:00–12:35) and whether baggage decides it, and the maintenance as a card of its own (12:00–13:30 → 12:45–14:15, what it clears, what it creates). Only what changes is filled in the brand's colour: A3, carousel 2, the new times; B11 and a carousel that stays stay neutral. **Baggage carousels** says which change it is about, as its card does, then the day in figures (flights, bags, the busiest hour, carousels out of service, clashes), then what the picked move does to the bags, on the board's chart with carousels for rows. A bar is bags on the belt, first bag to last, never the aircraft's turn: every one says its flight and bags, and, given room, where from and its hours. Late flights' bags reach back to when they were due off, as ghosts, and carousels out of service are hatched, maintenance moved in the brand's colour, with where it was dashed. XC344's 239 bags were to come off carousel 4 (dashed), and now come off carousel 2, 12:00–12:35 ("Bags move"); the Pier B move keeps theirs ("No change"). At the foot, the review's states (Pending review, Approved by Travis, Ready for your approval, Applied), **Cancel** and the decision, held at "Waiting for approval". When he picks up ("Travis joined"), the user greets him and hands over ("Hey Travis, Skye's moved a flight onto your carousels"), Skye not listening meanwhile (`hearCaller`), and she briefs him on his part only, in a breath, walking him through it from beside each thing, her tag away: "XC344 moves to A3 and its bags go from carousel 4 to 2. To make room, carousel 2's maintenance moves to 12:45–14:15. Can you approve?" Should the user say nothing, she opens with "Hey Travis. XD472 is running late, so…". She says it on a call, or writes it in the chat. **Before he decides, he asks her one thing**: "Quick one: does anything land on carousel 2 while the belt's out?" She answers from the plan's figures, in a sentence ("No. XC344's bags are off by 12:35, and the next are XA618's at 14:32, after it's back."), pointing at the maintenance, then the bags. Both show written under the agenda, so it can be followed with no audio. Answering aloud, he then says it works and it's approved, in one sentence, and stays on for the user, Skye's cursor on the decision: they thank him, Skye not listening, and approve, and he says goodbye ("Cheers, bye!") and drops off (`stayForGoodbye`, `farewell`). Otherwise each step comes in writing, and he approves after 10 seconds. Only that approves it: nothing he says on the way does. | `ApprovalsCall.tsx`, `approvalList.ts`, `CarouselTimeline.tsx`, `baggage.ts`, `baggageFixture.ts`, `teammateBrief`, `teammateFollowUp`, `teammateCue`, `callForReview` in `agentGestures.ts`, `briefAloud` and `briefInWriting` |
| Plan approved, impact shown | **Approve plan** applies it, and the call with Travis ends once he has said goodbye (4 seconds at most). Skye says it in a line: "Approved and logged. Gate hold is down from 6h 35m to none, no conflicts left." You go back to the board, framed on what moved, the stays still outlined and the rest dimmed, so the outcome can be read there, until the result is put away. The notification is now **Disruption cleared** ("Applied · Gate hold 6h 35m → none · Logged 02:30 PM"). Opened, it shows the same stretch of the board, now clear, what was applied, then Baseline → Now for gate hold, conflicts and stand use, against the board as the news arrived, plus who approved it. **Logs** opens Outputs, where the decision is under the request, and **Activity** under that has the whole record: the news, what Skye flagged, what she proposed, the call, his question and her answer, each approval, what was applied, each with who and when, then what is next. It reads as a record, not a transcript: it says what her narration leaves to the screen. The task in the dock opens it at any point, on any page. | `settleDisruption`, `settledLine`, `activity.ts`, `OutputsPanel.tsx` (`DecisionLog`, `ActivityLog`), `SkyeTask.tsx` |

## The scenario

| | |
| --- | --- |
| Late flight | XD472/473, B789 from London Heathrow, on B11. Scheduled 08:40–11:40; it is 1h 50m late in, for "Held at origin for a late inbound crew", and its 3h 00m turn carries the delay through: on B11 10:30–13:30. (It was 3h 10m late out, with 1h 20m of crew rest on top, until the demo was cut to 1:15: that ran into four flights, not two.) The notice, the chart and the record all say these same times. All of it lives in `DISRUPTION` in `src/operations/disruption.ts`. |
| Knock-on | It runs into the first two of B11's bank of quick turns behind it: XC344/345 (B788, due 11:50) and XB232/233 (B738, 13:05). Because each of those then leaves late, XA117/118 (13:55), XC336/337 (14:45) and XA109/110 (15:45) wait in turn: 5 aircraft, 6h 35m of gate hold in all. |
| Skye's plan | Move what it runs into, not the late aircraft (already inbound, and a widebody tow mid-turn). Same pier first, then nearest by row, with no new conflict anywhere. Two moves, each to a stand of its own: the B788 has no widebody stand free on Pier B, so it goes to A3; the B738 stays on Pier B (B10). Moving those two clears the three behind them without touching them. The Pier A move takes its bags to another pier, so baggage approves it. |
| Carousels | A3's carousel, 1, has XD608's bags until 12:15, on top of XC344's from 12:00. Carousel 2 is out for belt maintenance 12:00–13:30. Carousel 3 is free until XC330's bags at 12:40, but a belt needs 10 minutes to clear (`BELT_TURNOVER_MIN`), and XC344's are on until 12:35. So the maintenance moves on until XC344's bags are off and the belt has cleared, 12:45–14:15, the same length, clear of XA618's at 14:32. It is planned from the data, not written in: `planMaintenanceMove` in `baggage.ts`. |
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
export const DISRUPTION_TRIGGER: DisruptionTrigger = { on: "manual", afterMs: 3_000, noticeAfterMs: 600 };
```

- `"manual"`: only when the presenter cues it, with the next key
  (Ctrl+Alt+N, PageDown) or Ctrl+Alt+D (the default).
- `"connect"`: lands `afterMs` after a call to Skye connects (the old default).
- `"load"`: lands `afterMs` after the page opens, call or no call. This is
  closest to a real feed: Skye is watching whether or not you're talking to her.

Whichever you choose, the late flight and its conflict show on the board
first, and Skye speaks up `noticeAfterMs` later. On a call, the notification
waits for her voice: `LiveCallController.offer` lets her finish what she's
saying, sends the cue, and resolves when she's next heard (or after 8
seconds, when the heads-up also goes into the chat). The notification and
her voice arrive together however long the model takes.

The cue works whichever you choose. While Skye is mid-change, the news
waits until she's done.

## How it's wired

| Piece | Where |
| --- | --- |
| The news landing, notice words, the plan, the "why", Travis's briefing, the result | `src/operations/disruption.ts` |
| The golden path: the user's next step from wherever the demo is (`nextGoldenBeat`), and the presenter's key that presses its control (`useGoldenPath`) | `src/operations/goldenPath.ts` |
| The notification and its result (`DisruptionNotice`, on the board only), and Skye speaking up: heads-up, briefing, result (`DisruptionWatch`, on the board and the Approvals page) | `src/operations/DisruptionNotice.tsx`, `disruptionNotice.css` |
| Skye's notification itself: the pill, opening onto its preview and details, its motion and glass | `src/components/skye-notification/` |
| The board snippet in it: the board's rows, ruler and bars, only to look at | `src/stand-timeline-demo/BoardSnippet.tsx` |
| The Approvals page: its list, the call tiles, the stand changes, the decision, and opening itself when Travis is brought in (`useOpenApprovals`) | `src/approvals/ApprovalsPage.tsx`, `src/approvals/approvalList.ts` |
| The baggage: carousels and the day's plan, made from the sample flights; each arrival's bags on the board now; what a move does to them (`bagMove`); the carousels chart | `src/stand-timeline-demo/baggageFixture.ts`, `src/operations/baggage.ts`, `src/approvals/CarouselTimeline.tsx` |
| `resolve_disruption` (write) and `explain_plan` (read) | `src/live/appActions.ts`; also in the backend interpreter's list (`server/interpret.mjs`) |
| Deterministic phrasing, as for the pier closure ("resolve XD472's late arrival", "why not move XD472?") | `matchDisruptionRequest` and `withDemoShortcuts` in `src/live/requestInterpreter.ts` |
| The user's turn on Travis's call: their greeting (`LiveCallController.hearCaller`, `greetedBy` in `DisruptionNotice.tsx`), and Travis staying on to say goodbye as they approve (`stayForGoodbye`, `farewell` in `src/live/callGuests.ts`) | as named |
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
- **Travis's follow-up is unheard too.** The question, Skye's answer and his
  approval after it are in the tests, and were walked through on screen with
  no voice, but nobody has heard the two sessions take turns on a real call.
  He hears nobody, so she does not actually hear his question: the app gives
  her the answer, and him what she said.
- **Off a call, Travis is still a timer.** He asks his question and approves
  on a schedule (`briefInWriting`: 3s, 5.5s, then approval at 10s). His
  approval is not his to click: it lands on its own.
- **The shortened lines are unheard.** The brief, Travis's question and
  sign-off, and Skye's replies were cut to a sentence each and run on screen
  with no voice; nobody has heard them on a real call yet. Travis's turn now
  ends once he has approved (`teammateCueEnded`).
- **Your greeting is heard by its loudness, not its words.** While you greet
  Travis, Skye's input is held, so nothing transcribes it: the app listens to
  your microphone's level instead (`hearCaller`; started at about -39 dBFS for
  0.2s, done after 0.8s quiet). It has not been tried in a room. A noisy one
  may never go quiet (it gives up after 8 seconds of you talking), and a quiet
  microphone may never start it (she briefs after 4 seconds): the next key
  hands over either way.
- **Travis hears nobody, you included.** Your greeting and thanks are for the
  room; his goodbye is cued by your approval, not your words. A goodbye he
  never says holds the return to the board 4 seconds (`GOODBYE_WITHIN_MS`).
- **XD472's own late bags are not sorted out.** They land on XA626's on carousel
  4, so the figures still count those two as clashes after the plan. Only
  XC344's clash is cleared, by moving the maintenance. The baggage data is a
  synthetic plan made
  from the sample flights (`baggageFixture.ts`): 12 carousels; each flight's
  checked bags by aircraft type, a little more or less flight to flight;
  first bag 10 minutes after on-block, then 7 bags a minute (20 minutes at
  least); three outages on the day; and each pier's flights spread over all
  its carousels. A flight moved to another pier goes to the new stand's
  nearest carousel.
- **Off a call, Skye's replies go to the chat**, which stays closed unless
  you open it (Ctrl+K). The board and the approval card carry the story either
  way.
- **After Dismiss** the notice is gone for good. The conflict stays in Alerts,
  and asking Skye to "resolve the disruption" still works.
- **"Capacity"** in the script is shown as Stand use and Stand time. The plan
  takes stand use from 49% to 50%, because the two moved stays now take
  stand time of their own.
