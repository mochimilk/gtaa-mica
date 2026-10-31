# Multi-cursor demo: Skye clears a closed pier

> **DEV NOTE — prototype, concept not settled.** This flow exists so we can
> *show* Skye working on several things at once. What "Skye as several
> agents" should mean in the product is still open; see
> [Open questions](#open-questions-the-concept-needs-thinking-through)
> before building on it.

## Running it

1. `npm run dev` and open the app. The voice broker isn't needed for typed requests.
2. Open the Ask Skye chat (the chat button left of the pill at the bottom, or Ctrl+K).
3. Type, or say on a call:

   > **Pier B is closed from 9 to 1 for an inspection — move everything off it.**

4. To run it again, reload the page (the board is a local fixture), or select
   any stay and press **Reset stands** in its details.

Skye works straight through, then her changes wait on the board for approval
(see [Approving Skye's changes](#approving-skyes-changes)).

Other phrasings that trigger the same flow:

| Say | Closes |
| --- | --- |
| "Close Pier C between 10 and 2" | Pier C, 10:00–14:00 |
| "Pier A lost power until 1pm" | Pier A, start of day–13:00 |
| "Pier D is down for maintenance 09:30-11:45" | Pier D, 09:30–11:45 |
| "Move everything off the remote stands" | Remote, all day |

Hours without am/pm are read as the working day ("9 to 1" is 09:00–13:00).
With no window, the closure covers the whole day on the chart, which means
many more moves and a longer run. For the demo, give a window.

## What the audience sees

1. A red hatched band appears over Pier B's stands, 09:00–13:00, labelled
   "Pier B closed 09:00–13:00", and the chart glides to frame it.
2. Skye's cursor leaves the orb and goes to the middle of the screen, over the
   band. Its tag counts the work: "Pier B closed · 0/11 moved".
3. There Skye splits into up to five helpers, small orbs of light, and Skye's
   own dot becomes a live orb (32px, as in the Ask pill) that stays in the
   middle of the screen while they work (going back if the window is
   resized), glowing, so it reads as Skye directing them rather than one more
   hand. Everything that glows here is one colour, `--agent-cursor-light` in
   `agent-cursor.css`: by default black on a light page and white on a dark
   one. **Glow** in Settings (the avatar's menu, Appearance) picks Default,
   Aurora (blue-violet), Seafoam (sea-green) or Iris (sky blue). A ring round the
   orb fills as the stays move, a loading bar for the whole job. Solid, glowing
   lines run from the ring to each helper, and more join everyone in
   triangles, a web over the work. Every 2.6 seconds a glowing orb of light
   leaves the ring, runs down the lines to the helpers and splits at each one,
   with sparks along the web. A helper whose job only became possible because
   of another helper's move (it lands where that move took a stay from) waits
   for that move and is tethered from that helper instead. No move in a
   closure depends on another today, so here every helper is tethered from
   Skye; see `madeRoomBy` in `agentGestures.ts`. The helpers have no
   names; a helper's tag shows only while it is moving a stay. Each one
   takes a stay off the pier, its tag showing its job ("XD456/457 → C25"),
   and they all drag at the same time. Green ghosts show where each stay
   lands.
4. Stays out of view wait. The chart re-frames on what's left and the helpers
   go again, a few rounds until the pier is clear.
5. The helpers merge back into Skye's orb, which shrinks back into a dot.
   Skye returns to the now-empty band, every moved stay is outlined, and Skye
   replies with what it did.

In a 1600×1000 window, with the chat open over the bottom of the board, the
cursors move all 11 stays in about 27 seconds, in four rounds. The reply
lands at about 35 seconds. Over voice, with the chat closed and more of the
board visible, it takes fewer rounds. A larger window helps too.

## How it works

| Piece | Where |
| --- | --- |
| The request: `close_area { area, from, to }`, planned on validation, applied idempotently | `src/live/appActions.ts` |
| The plan: each stay on the area in the window to the nearest free stand that fits it, widebodies and longest stays first, held 15–90 min only if nothing is free | `planAreaClosure` in `src/operations/allocation.ts` |
| The closure rule (nothing on a closed area while it's closed) and the band on the chart | `allocation.ts`, `src/operations/ClosureBand.tsx` |
| The choreography: frame, split, parallel rounds, merge | `closeArea` in `src/operations/agentGestures.ts` |
| Helper cursors: a fixed pool of five extra cursor controllers, each with its own pointer id; the tethers, web and light between them (`showTethers`) | `src/components/agent-cursor/agentSwarm.ts` |
| Skye's aura: the ring round her orb that fills with the work (`setProgress`) | `AgentCursor.tsx`, `agent-cursor.css` |
| Several drags at once: the chart keeps one drag per pointer; only the primary pointer autoscrolls | `useBarDrag` in `src/stand-timeline/layers.tsx` |
| Moves land quietly during the run (no per-stay selection or popover), and the moved stays are highlighted at the end | `runSkyeBatch` and `closeArea` in `src/operations/OperationsContext.tsx` |
| The trigger phrase, matched before any interpreter | `matchAreaClosure` and `withDemoShortcuts` in `src/live/requestInterpreter.ts` |
| Working out of sight: the page Skye's cursor works on (the board, or the Chat page while she walks a teammate through the shared approval) stays mounted behind any other page, hidden and inert, so her work carries on there; her cursors hide with it, and a drag in flight when the board goes or comes back is let go and taken up again. Beside that page's nav rail entry, a note says "Skye is still working here" with what she's doing (her cursor's tally, as "Pier B closed · 3/12 moved"), then "Skye is done here" if she finishes while you're away, until you go there or dismiss it | `src/live/outOfSight.ts`, `App.tsx`, `AppNavRail.tsx`, `playAgentGesture` and `dragStay` in `agentGestures.ts`, `src/approvals/walkThrough.ts` |

**The trigger is deterministic on purpose.** `withDemoShortcuts` recognises
the closure phrasing before the interpreter model is asked, so the demo plays
the same way every time, even with no voice backend running. The backend
interpreter also knows `close_area` (it's in its schema and instructions), so
other phrasings can still reach it when the model is configured. Remove the
shortcut once the concept is settled and the model path is trusted for it.

The cursors are the visible part. As with every Skye action, the executor
then applies `close_area` itself. That apply lands anything the cursors
didn't (a stay still out of view after the last round), so the end state
doesn't depend on the animation.

## Open questions: the concept needs thinking through

The demo answers none of these. It picks the simplest thing that shows well.

- **One agent with several hands, or several agents?** Today it's one plan,
  made up front by one deterministic planner, carried out by several cursors.
  The helpers don't reason, choose or talk. If we mean real sub-agents
  (each planning its own part, negotiating for the same free stand), that's
  a different architecture with real coordination problems.
- **Who does the user talk to?** One Skye voice, one reply. If helpers are
  "agents", can the user address one ("Skye 3, stop")? Today they can't.
- **Approval and trust.** Every stand change Skye makes now waits on the
  board for approval, with one Cancel for the whole batch (see below). Still
  open: whether a plan this big should be confirmed *before* the cursors
  move (show the arrows, then go), and what happens when the board moves on
  while a review waits.
- **Undo and attribution.** There's no per-batch undo, only Reset stands for
  everything. The outline shows what moved, not which helper moved it or why.
- **Interruption.** Starting another request stops the run where it is. The
  apply doesn't run then, so a half-cleared pier stays half-cleared. Should a
  batch be atomic?
- **Is the animation the product?** Parallel cursors read as "busy" and look
  great in a demo. But a person can't follow five things at once. Is the
  value in watching, or in the result plus a clear summary?
- **Scale.** Five helpers and a few framing rounds suit roughly 5–20 moves.
  A whole-day closure (19+ moves) gets long. Beyond that, an animated drag
  per stay stops making sense.
- **Planning quality.** The planner is greedy and knows only the sample rules
  (overlap, stand size, closure, an aircraft can't be on two stands at
  once). It keeps stays near their pier but knows nothing about gates,
  towing cost, passengers or airline preferences.

## Approving Skye's changes

Every change to the board is listed in the **Outputs** panel (its toggle ends
the board's header, after Filters and Views), newest first, under who made
it: each request Skye works on ("Fix all conflicts"), and each thing you do
yourself (a drag, a swap, Reset stands). Under each one is every
piece it moved, turn by turn, like moves listed under a chess game
("XA101/102 · A1 → C25"), each with Ask Skye's step spinner:

- **Four dots** while Skye has hold of the piece.
- **A check** once it lands, if nothing needs a teammate. Your own changes
  need no one's approval, so they show checks straight away.
- **A half-dashed circle**, in amber, while a teammate still has to approve it, then a check
  once they have, with their avatar beside it.
- **An undo arrow**, the piece struck through, once Skye's changes are
  cancelled. The request then reads "Cancelled by you" instead of "Waiting
  for approval"; cancelling isn't listed as a change of your own.

While the panel is closed, the request Skye is on peeks out at the board's top
right, under the header, showing up to five and a half pieces. Once she's
done it becomes the compact approval: it glows like the light at the foot of
the page, and stays until you decide. Opening the panel puts it away (the
decision is in the panel too, under the request waiting, threaded to its
pieces), and closing the panel brings it back.
The decision is a full-width primary button with **Cancel** under it. When the
changes need baggage, the primary button reads **Review with baggage**, which
calls Travis in, then **Waiting on baggage** while he's called and looks, and
**Approve** once he has approved.

**The Approvals page.** Calling Travis in (**Review with baggage**, or a yes
to Skye's offer) switches to the Approvals page, the second entry in the nav
rail, which counts what waits. Its panel lists what waits, then what was
decided (approved or cancelled). The plan open fills the page: its title, with
Teams' meeting bar while there is a call (only the microphone and **Leave**
work), over the call's tiles (the floating call window stays hidden there). Under them, two panes. **Stand changes**
lists every change as a card (arrival, from stand → to stand, departure);
pick one. **Baggage carousels** shows what it does to the flight's bags, on
the board's chart with the carousels for rows: where they came off before
(dashed), where they come off now, and any other flight's bags they clash
with there, in red. At the foot, **Cancel** and the decision: **Review with
baggage**, "Waiting for approval" while Travis is called and looks, then
**Approve plan**. The baggage data is synthetic, made from the sample
flights (`src/stand-timeline-demo/baggageFixture.ts`).

A change needs **Travis Hughes (Baggage operations)** when it moves a
flight's bags: another pier or the remote stands, a stand gained or lost, or
new times. A move between stands on the same pier at the same times doesn't.

**Calling Travis.** When Travis has to approve and isn't on the call, Skye
asks, in a few words: "Baggage operations in Terminal B approves first,
then you. Want me to call them?" A "yes" calls him (her
cursor uses the People list), which is the same as pressing **Review with
baggage**. He looks at the change once he picks up, about 5 seconds later
(`ANSWER_MS`), and approves 10 seconds after that (`SIGNOFF_MS`), once Skye has briefed him. If he's
already on the call, the change goes straight to him. This call offer
replaces any "want me to fix the next thing?" offer in the same reply, so a
yes means one thing.

**Approve** keeps the changes. **Cancel** puts every stay Skye moved back where
it was, reopens a closed area (a stay someone has moved again since is left
alone), and clears every selection, yours and Skye's. Changes Skye makes
while others are waiting join them, and Travis is asked again from the start.

Nothing reaches Travis. The rule and the people are in
`src/operations/skyeReview.ts` and the `TEAM` list in
`src/live/callGuests.ts`, where every person has an expertise. The page is
`src/approvals/ApprovalsPage.tsx`, and what it lists is in
`src/approvals/approvalList.ts`. The bags are in `src/operations/baggage.ts`,
and their chart is `src/approvals/CarouselTimeline.tsx`.

Skye's swaps are no longer asked about before she drags; the approval covers
them. The user's own swaps still ask first, beside the two stays.

## Also in this change: drag anywhere

People can drag a stay anywhere on the board. Up or down changes the stand,
left or right changes the time in 5-minute steps, and diagonal does both. The
ghost shows the new times in a pill ("07:40–09:20 +1h 00m"), and it turns red
where the drop breaks a rule. A little sideways wobble (under 12px) is ignored,
so a straight up or down drag still keeps its times.
