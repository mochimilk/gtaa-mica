# GPT-Live voice in Mica

Voice is implemented. Mica places a real WebRTC call to GPT-Live, mutes and
hangs up for real, and runs app actions the model delegates to the client.

Talking works as soon as the broker runs with a key, and acting on the board
works once `MICA_INTERPRETER_MODEL` is set. The chosen interpreter model for
this project is **`gpt-6-luna`**. There is deliberately no runtime fallback: if
the setting is blank, calls still connect and talk normally but Mica says
plainly that it cannot act on requests.

Live validation so far is small: see [What has been checked live](#what-has-been-checked-live)
and [What is still unverified](#what-is-still-unverified).

## Why there is a backend at all

GPT-Live's WebRTC flow starts the session from a server call that carries the
project key, and returns the SDP answer. There is no ephemeral client token to
hand the browser, so Mica has its own loopback broker:

```
browser/Electron ──SDP offer──▶ server/micaLiveServer.mjs ──▶ api.openai.com
                 ◀─SDP answer──                            (project key here)
```

The renderer never holds a credential. The key lives only in the broker
process, is never written to a response, and is never read into a `VITE_*`
variable (those are inlined into the client bundle).

## Setup

1. Copy `.env.example` to `.env` and fill in `OPENAI_API_KEY`. Use a project
   key with GPT-Live access. `.env` is gitignored.
2. Set `MICA_INTERPRETER_MODEL=gpt-6-luna` (see
   [The interpreter model](#the-interpreter-model)). Voice actions do not work
   without it.
3. Start the broker, then the app, in two terminals:

```text
npm run dev:voice
npm run dev
```

`dev:voice` loads `.env` through Node's own `--env-file-if-exists`, binds
`127.0.0.1:8787`, and prints which settings it found — including whether the
key and the interpreter model are present. It never prints the key.

`npm run dev` proxies `/api/live` to the broker, so voice requests stay
same-origin and the renderer needs no backend URL. Electron development uses
the same dev server, so it works the same way. Microphone capture requires
HTTPS or localhost; the dev server is localhost.

Voice needs the broker running. Without it the call fails with "Mica's voice
backend is not running", and the chat still works.

## The interpreter model

`session.delegation.created` carries a delegation id, a target and a timeline
offset — and [explicitly not the user's words](https://developers.openai.com/api/docs/guides/live-delegation).
With `delegation: { type: "client" }` Mica is the executor, so it has to
reconstruct the request from the transcript it accumulated. Doing that
conversationally needs a reasoning model, and picking one is a cost, latency
and capability tradeoff that no one should make on your behalf.

[`gpt-6-luna`](https://developers.openai.com/api/docs/models/gpt-6-luna) is the
model chosen for this, and it suits the shape of the task: one or two sentences
in, one small JSON decision out, against a fixed action list, inside a spoken
turn where latency matters more than raw capability. It supports the Responses
API and strict structured outputs, which this route requires.

The setting stays configurable, with no hardcoded default in the code, so
changing model is an environment change rather than a code change. If a
reasoning-heavy model reports `interpreter_budget_exhausted`, raise
`MICA_INTERPRETER_MAX_OUTPUT_TOKENS` — that budget covers reasoning tokens.

There is also an offline mode, `VITE_MICA_INTERPRETER=phrase`, which uses a
deterministic phrase matcher over Mica's own fixture vocabulary. It is for
demos and tests. It handles a bounded set of phrasings, ignores conversation
history entirely, and so cannot take a correction or a follow-up. **It is
never a silent fallback**: if the interpreter model is unset or failing, Mica
says it cannot act rather than quietly degrading.

## How a call runs

Session creation, in the broker, is the documented WebRTC flow:

```js
{
  session: {
    model: process.env.MICA_LIVE_MODEL,       // gpt-live-1
    instructions: MICA_LIVE_INSTRUCTIONS,     // app-authored, server-owned
    audio: { output: { voice: process.env.MICA_LIVE_VOICE } },  // marin
    delegation: { type: "client" },
    store: false,
  },
  transport: { type: "webrtc", sdp: browserOffer },
}
```

`audio.format` is omitted, as the WebRTC guide requires. `store: false` is
Mica's session storage choice — it does not ask the API to retain this
conversation for later retrieval. That is not a claim about provider-side
retention in general.

The renderer (`src/live/liveTransport.ts`) then, in this order: takes the
microphone, creates the `oai-events` data channel **before** the offer, adds
the audio track, creates and sets the offer, waits for ICE gathering, posts the
offer to the broker, applies the answer, and waits for `session.started`. It
never sends `session.start`, which WebRTC forbids.

Once the session is up, Mica sends the board context, then one
`session.instructions.append` (`GREETING_INSTRUCTIONS` in
`src/live/callController.ts`) so Skye picks up with a casual hello instead of
waiting for the caller to speak first.

Hanging up sends `session.close`, waits a bounded time for `session.closed`,
then releases the tracks and the connection regardless — a disconnected
session never blocks cleanup.

### Actions the model can delegate

`src/live/appActions.ts` is the whole allowlist. Every identifier is validated
against the real demo fixture, so an unknown flight, alert, view, filter
dimension or filter value is rejected rather than coerced into something near
it:

| Action | Effect |
| --- | --- |
| `find_flights` | Read-only search of the fixture |
| `describe_selection`, `list_alerts` | Read current state; `list_alerts` reads every open alert, grouped: flights with no stand, conflicts, notices |
| `brief` | Read-only: getting going ("start my day", "how are the stands looking", "what does my day look like", "what's next"). How much is open, then every item in the Alerts window's order, a few words each, and an offer to take it all as one plan; a yes carries it out as `fix_all`, whose reply is one sentence pointing to Outputs for the details |
| `list_conflicts` | Read-only: the conflicts, where a late stay's delay runs into another stay on its stand (the red ghosts on the chart) |
| `select_flight` | Selects a flight, exactly as a flight-list click does |
| `select_flights` | Selects several flights' stays on the chart together, or adds them to the selection, as Ctrl-clicking their bars does |
| `clear_selection` | Clears it |
| `set_view`, `set_filter`, `reset_filters` | Views and filters |
| `acknowledge_alert`, `unacknowledge_alert` | Demo alerts |
| `move_stay` | Moves a flight's stay to another stand, keeping its times; Skye drags the bar there |
| `swap_stays` | Two stays trade stands; Skye drags one onto the other (or each in turn when they do not overlap) |
| `suggest_move` | Read-only: the move or swap that most widens the tightest gap between stays, offered with "Want me to do it?" |
| `close_area` | Closes a stand area (optionally for a time window) and moves every stay on it then to free stands; Skye splits into several cursors to drag them at once. See [multi-agent-demo.md](multi-agent-demo.md) |
| `assign_stands` | Gives stands to flights with none (named, or all of them), keeping their stay times: onto a named stand for one flight, otherwise the first free stand that takes each. Says why each flight it cannot place could not be placed. Skye drags each flight out of the Arrivals/Departures list and onto its stand, one at a time, even when asked to place them all; people can drag them the same way |
| `add_to_call`, `remove_from_call` | Brings a teammate from the people list (Priya Raman, Marcus Chen, Aisha Okafor, Travis Hughes, each with an expertise; `TEAM` in `src/live/callGuests.ts`) into the call, or takes them off. Skye clicks the call window's **Add people** menu (or, off a call, the People list), or the tile's remove button. They only show on the call window; nothing reaches them |
| `unassign_stands` | Takes flights' stays off their stands, and so off the chart; arrival and departure come off together. Skye clicks each bar, then the popover's **Unassign** |

Stand changes are demo-only. They live in the open page (`src/operations/allocation.ts`):
nothing is saved or sent, a reload restores the fixture, and the popover's
**Reset stands** undoes them (and reopens a closed area). Each change is
checked against sample rules only: no overlap with another stay on the stand,
the stand's sample size (`SyntheticStand.size`) fits the aircraft, nothing on
a closed area while it is closed, and a stay moved in time does not overlap
its own aircraft's other stays. An aircraft with no type recorded counts as a
widebody, so it only goes on a stand that takes any aircraft. People can also
drag a stay along in time on the chart; Skye only changes times when closing
an area leaves a stay no free stand until later. There is still no allocation
backend: the rules are samples, and conflicts from late stays are not checked.

Flights with no stand have synthetic stay times in the fixture
(`UNASSIGNED_FLIGHTS` in `src/operations/operationsData.ts`), so they can be
given a stand, by Skye or with the selection popover's **Assign stand**. XB241
deliberately has none, so asking Skye to fix the no-stand flights shows it
explaining what it could not do. A stay taken off its stand keeps its times,
and its flights show as having no stand until it is given one again.

Alerts are derived from the board as it is (`src/operations/boardAlerts.ts`):
a conflict from a late stay, a flight with no stand, and two fixed notices,
listed most pressing first (conflicts soonest first, then flights that can be
placed, then flights with no stay times, then notices). They clear and
reappear as stands change. `brief` works from that order and offers the whole
`fix_all` plan (`src/operations/priorities.ts`: a conflict is cleared by
moving what the late stay runs into to a nearby free stand that adds no
conflict, then the waiting flights go onto free stands around that). The offer
says what it keeps and what it moves, and promises to keep the late aircraft
on their stands only when the plan does. Asked for one item instead, Skye
makes that change, says what it cleared and offers the next, so the open items
can also be worked through one at a time.

A suggestion is never acted on by itself. `suggest_move` returns the offered
change as a `proposal`, which the executor keeps in the task history; only a
confirmation in the next request ("yes", "do it") carries it out, through
`move_stay` or `swap_stays` with exactly those arguments.

Everything runs through `OperationsContext`, the same state the UI uses — no
simulated clicks. `SelectionPopover` behaviour is untouched, including the
`data-ops-keep-selection` convention.

### Progress, results and context

| Channel | Used for |
| --- | --- |
| `session.thinking.append` | Quiet facts: board context, progress. Not spoken. |
| `session.commentary.append` | The result the user should hear. |
| `session.instructions.append` | App-authored steering only, e.g. "do not claim that was done". |

Injected content is held to a hard UTF-8 byte budget. The documented limit is
500 tokens, and a character count cannot bound tokens; byte-level BPE gives
`tokens <= utf8Bytes`, so 480 bytes is provably inside the limit for any
script. Board context is re-sent, debounced, whenever you change the board by
hand, so later questions are answered against what is on screen.

### Cancellation and staleness

- Muting does **not** cancel work in progress, and neither does talking over
  the agent. Only a hangup, a session close or a newer request supersedes a job.
- A cancelled or superseded job can never reach the app: every `await` is
  followed by a staleness check, and cancelling aborts the interpreter request
  rather than just discarding its answer.
- Each delegation id runs at most once.
- Plans are validated against the board revision they were made for. If you
  change the board mid-interpretation, the request is replanned once; if the
  board is still moving, it is refused out loud instead of applied to state it
  was not planned against.
- There is no per-response completion event in GPT-Live, so playback activity
  and backend task state are tracked separately.

## Electron

The desktop shell grants exactly two things it did not before: microphone
access for the app's own origin, and `connect-src`/`media-src` reach for the
SDP exchange and the agent's audio. Camera, screen capture and every other
permission stay denied, and sandboxing, context isolation and disabled Node
integration are unchanged.

A packaged build has no dev-server proxy, so it needs the broker's URL at build
time:

```text
VITE_MICA_API_BASE_URL=http://127.0.0.1:8787 npm run build:desktop
```

Set `MICA_LIVE_BACKEND_ORIGIN` for the main process if the broker is not on the
default port, so the CSP matches. Only loopback http origins are accepted.

## Security scope: local development only

The broker is **not** deployable as written, and this is a deliberate choice
rather than an omission. Mica has no user authentication, so there is nothing
to authorize a session request against, and an open session-minting route is a
paid, abusable endpoint.

What it does enforce: loopback binding, a `Host` check, an `Origin` allowlist,
JSON-only bodies with a size cap, SDP validation that accepts one audio track
and at most one data channel (video is rejected), bounded upstream timeouts,
and abort-on-client-disconnect so an abandoned connect does not finish minting
a session. Upstream error text is never forwarded to the browser: provider auth
errors can quote part of a key, so the browser gets fixed Mica-authored
messages and the operator gets the status and upstream error code only.

Before hosting Mica: put `/api/live/session` and `/api/live/interpret` behind
real app authentication, then revisit the origin and host checks.

## Ask Skye (navbar center)

The navbar's center holds Ask Skye, temporarily in place of the Stand plan /
3D Map switch (`ViewSwitcher`, which nothing listened to yet). It is VelmAI's
conversational surface on Mica's own setup, with no second integration:

- **Typed requests** go through `runTypedRequest`, the same executor voice
  requests use, with the `/api/live/interpret` route (`MICA_INTERPRETER_MODEL`).
  Replies are the executor's own results, so the chat can only report
  what Mica actually did or refused. Stop cancels a typed request in flight
  (`cancelTypedRequest`) and never touches voice work.
- **Voice** is the shared GPT-Live call from `LiveCallProvider`. Connect in
  the pill places the call; the voice bar has Skye's orb, a level meter (read
  from the call's own microphone and agent streams, nothing recorded), the
  running time and a red Disconnect. Mute sits outside the bar, on its right. The call's transcript
  joins the conversation as spoken turns.
- **Rendering**: Coral's `Chat.Canvas` owns the conversation and
  `Chat.Messages` draws it. The input, buttons and voice bar are VelmAI's
  custom controls (`src/components/ask-skye`), styled with Fluent's CSS
  variables rather than replaced by Fluent components. VelmAI's slash menu,
  draggable/resizable window and text-to-speech read-back were not ported:
  GPT-Live speaks for itself.

## What has been checked live

On 2026-10-15, with the broker's existing `.env`, through the running UI:

- `/api/live/health` reported GPT-Live and the interpreter ready.
- Two typed requests reached `gpt-6-luna`: "List the open alerts" chose the
  read-only `list_alerts`, and "Assign XB240 to stand B12" came back
  `unsupported` (no allocation backend). Nothing was applied by either.
- One ~13-second GPT-Live call connected (session route 200, about 2.6 s),
  Skye's greeting was transcribed into the chat, and mute, unmute, typing
  during the call and hang-up all behaved. The browser's microphone was
  Chromium's **fake test-tone device**, not a person speaking.

## Verifying

```text
npm test              # key-free lifecycle, action and broker tests
npm run build         # tsc -b (app, node, tests) + vite build
npm run check:server  # typechecks the broker with checkJs
npm run check:desktop # typechecks the Electron sources
```

`npm test` uses synthetic environments and mocked transports throughout. It
never reads `.env`, never constructs a real `RTCPeerConnection`, and never
sends a request to any API.

For a review build that must not pick up a private `.env`, disable env loading
through Vite's JS build API. There is no `--envDir` command-line flag:

```js
// scratch/secret-free-build.mjs — run with `node scratch/secret-free-build.mjs`
import { build } from "vite";

await build({ envDir: false });
```

## What is still unverified

- **No call with a real human speaker.** The one live call used a synthetic
  test tone, so speech recognition, turn-taking feel, audio quality and
  end-to-end latency are untested.
- **Voice delegation has not run live.** No `session.delegation.created` has
  been received from a real call; that path, and `gpt-6-luna`'s decisions on
  real spoken transcripts, have only been exercised with mocks. Two typed
  interpretations are the only real model decisions so far.
- Windows packaged-Electron voice (microphone prompt, CSP, audio playback) has
  not been run.
