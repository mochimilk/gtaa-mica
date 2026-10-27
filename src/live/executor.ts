// The one executor for client-delegated work.
//
// Exactly one of these runs per call. The live guides are explicit that if both
// the browser and a backend observe a session, the work must still run once, so
// Mica keeps a single owner and tracks every delegation id it has already seen.
//
// Progress and results go back through the three injection channels:
//   - `thinking`    quiet facts (board context, progress), not spoken
//   - `commentary`  the result the user should hear
//   - `instructions` app-authored steering, used only to stop the model
//                    claiming something Mica cannot do
//
// Requests typed in the chat take the same path (`handleTypedRequest`) and
// share the one job slot, but their result is returned to the chat instead of
// being spoken. Before a write is applied, the host may carry it out on screen
// (`OperationsHost.gesture`: Skye's cursor clicking the real controls); the
// apply that follows is then a no-op guarantee. What a write changes on the
// board then waits there for approval (`OperationsHost.beginChange`).
//
// Cancellation rules that matter:
//   - Muting the microphone does NOT cancel work, and neither does the user
//     talking over the agent. Only a hangup, a session close, or a newer
//     delegation supersedes a job.
//   - A cancelled or superseded job must never reach `applyAppAction`. Every
//     await is followed by a fresh staleness check.
import {
  ACTION_KIND,
  applyAppAction,
  openWork,
  type AppAction,
  type ApplyResult,
  type SpeechCue,
  type WhileTalking,
} from "./appActions.ts";
import { injectionByteLength, MAX_INJECTION_BYTES, type InjectionKind, type LiveDelegationCreated } from "./liveEvents.ts";
import { describeSnapshot, type ChangeWait, type OperationsHost } from "./opsHost.ts";
import {
  phraseInterpreter,
  SUPPORTED_REQUEST_SUMMARY,
  type InterpretedRequest,
  type RequestInterpreter,
  type TaskHistoryEntry,
} from "./requestInterpreter.ts";
import type { TranscriptLog } from "./transcript.ts";

/** Sends one injection event. Resolution means accepted for injection only. */
export type InjectFn = (kind: InjectionKind, delegationId: string | null, content: string) => void;

/** Cancels a scheduled callback. */
export type CancelFn = () => void;
export type ScheduleFn = (callback: () => void, delayMs: number) => CancelFn;

export type ExecutorLogEntry = {
  delegationId: string | null;
  outcome:
    | "ignored_target"
    | "duplicate"
    | "superseded"
    | "cancelled"
    | "no_transcript"
    | "applied"
    | "rejected"
    | "unsupported"
    | "unclear"
    | "context_sync"
    /** Skye's cursor could not act the change out; it is applied anyway, at once. */
    | "gesture_failed";
  detail: string;
};

export type ExecutorOptions = {
  host: OperationsHost;
  inject: InjectFn;
  transcript: TranscriptLog;
  interpreter?: RequestInterpreter;
  /**
   * How long to wait for trailing transcript deltas before reconstructing the
   * request. The model can delegate as soon as it understands, while the end
   * of the same sentence is still being transcribed.
   */
  settleMs?: number;
  /** Debounce for re-sending board context after the user changes something. */
  contextSyncMs?: number;
  schedule?: ScheduleFn;
  onBusyChange?: (busy: boolean) => void;
  onLog?: (entry: ExecutorLogEntry) => void;
};

/** How long after a reply its cues wait for Skye to say them, ms. */
const CUE_WINDOW_MS = 60_000;
/** Skye quiet this long counts as done talking about it, ms. */
const QUIET_MS = 4_000;
/** A typed reply's subject stays shown this long, there being no speech to follow, ms. */
const TYPED_SHOW_MS = 15_000;

/** Lowercase letters and digits only, so "the A1 conflict" and "a1 conflict" match. */
const squashWords = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

type Job = {
  delegationId: string;
  seq: number;
  offsetMs: number;
  /** A request typed in the chat; null for voice, which is read from the transcript. */
  typed: string | null;
  /**
   * The delegation id this job's injections carry. Null for a typed request:
   * the session never delegated it, so its context is session-wide.
   */
  injectId: string | null;
  /** Where the user-facing result goes: spoken commentary, or the chat reply. */
  reply: (text: string) => void;
  cancelled: boolean;
  reason: string | null;
  cancelSettle: CancelFn | null;
  /** Aborted on cancel/supersede so a backend interpreter stops its request. */
  aborter: AbortController;
};

const defaultSchedule: ScheduleFn = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

/** Enough history for corrections and follow-ups without unbounded growth. */
const MAX_TASK_HISTORY = 6;

/**
 * A reply with what Skye says of her change waiting for approval, when it
 * has to. Said on a call only when it fits in what she can be told to say:
 * the review on screen shows it anyway.
 */
function withWait(job: Pick<Job, "typed">, reply: string, waiting: ChangeWait | null): string {
  if (!waiting) return reply;
  const both = `${reply} ${waiting.say}`;
  return job.typed !== null || injectionByteLength(both) <= MAX_INJECTION_BYTES ? both : reply;
}

/**
 * The reply to an applied change, with the wait and Skye's offer to call
 * whoever has to approve it. That offer takes the place of any the reply
 * made (the next thing to fix), so a yes means one thing; and it is only
 * made when the question is said, cutting the reply to its first sentence
 * on a call if it has to.
 */
function tellApplied(
  job: Pick<Job, "typed">,
  result: Extract<ApplyResult, { ok: true }>,
  waiting: ChangeWait | null,
): { reply: string; proposal?: AppAction; cues?: SpeechCue[]; whileTalking?: WhileTalking } {
  const offer = waiting?.offer;
  if (!waiting || !offer) return { ...result, reply: withWait(job, result.spoken, waiting) };
  const base = result.withoutOffer ?? result.spoken;
  const fits = (text: string) => job.typed !== null || injectionByteLength(text) <= MAX_INJECTION_BYTES;
  const firstSentence = base.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? base;
  const reply = [base, firstSentence]
    .map((text) => `${text} ${waiting.say} ${offer.ask}`)
    .find(fits);
  if (!reply) return { ...result, reply: withWait(job, result.spoken, waiting) };
  // The cues went with the offer it replaced.
  return result.withoutOffer ? { reply, proposal: offer.action } : { ...result, reply, proposal: offer.action };
}

const BOARD_MOVED_REPLY =
  "The board changed while I was working that out, so I did not apply it. Ask me again and I will use what is on screen now.";

export class DelegationExecutor {
  #host: OperationsHost;
  #inject: InjectFn;
  #transcript: TranscriptLog;
  #interpreter: RequestInterpreter;
  #settleMs: number;
  #contextSyncMs: number;
  #schedule: ScheduleFn;
  #onBusyChange: ((busy: boolean) => void) | undefined;
  #onLog: ((entry: ExecutorLogEntry) => void) | undefined;

  #seen = new Set<string>();
  #current: Job | null = null;
  #seq = 0;
  #busy = false;
  /** Recent finished tasks, oldest first, so a request can correct the last one. */
  #history: TaskHistoryEntry[] = [];
  #cancelContextSync: CancelFn | null = null;
  #lastSyncedRevision: number | null = null;
  #disposed = false;

  constructor(options: ExecutorOptions) {
    this.#host = options.host;
    this.#inject = options.inject;
    this.#transcript = options.transcript;
    this.#interpreter = options.interpreter ?? phraseInterpreter;
    this.#settleMs = options.settleMs ?? 400;
    this.#contextSyncMs = options.contextSyncMs ?? 1_200;
    this.#schedule = options.schedule ?? defaultSchedule;
    this.#onBusyChange = options.onBusyChange;
    this.#onLog = options.onLog;
  }

  /** True while a delegation is being worked on. Independent of audio playback. */
  get busy(): boolean {
    return this.#busy;
  }

  /** Delegation ids already handled, for duplicate protection. */
  get handledDelegationIds(): readonly string[] {
    return [...this.#seen];
  }

  #log(entry: ExecutorLogEntry): void {
    this.#onLog?.(entry);
  }

  #setBusy(busy: boolean): void {
    if (this.#busy === busy) return;
    this.#busy = busy;
    this.#onBusyChange?.(busy);
  }

  /** A job may only touch the app while it is still the current, live job. */
  #isStale(job: Job): boolean {
    return this.#disposed || job.cancelled || this.#current !== job;
  }

  /* ----------------------------------------------------------- delegation */

  handleDelegation(event: LiveDelegationCreated): void {
    if (this.#disposed) return;

    if (event.target !== "client") {
      // Responses-delegated work is run by the API; executing it here too
      // would be the double-execution the guides warn about.
      this.#log({ delegationId: event.delegationId, outcome: "ignored_target", detail: `target=${event.target}` });
      return;
    }
    if (this.#seen.has(event.delegationId)) {
      this.#log({ delegationId: event.delegationId, outcome: "duplicate", detail: "already handled" });
      return;
    }
    this.#seen.add(event.delegationId);

    const job = this.#startJob({
      delegationId: event.delegationId,
      offsetMs: event.offsetMs,
      typed: null,
      injectId: event.delegationId,
      reply: (text) => this.#inject("commentary", event.delegationId, text),
    });

    // Quiet progress: not spoken, but available if the user asks what is
    // happening. Carries the delegation id, as task updates must.
    this.#inject("thinking", job.delegationId, `Reading the Mica board. ${describeSnapshot(this.#host.snapshot())}`);

    job.cancelSettle = this.#schedule(() => {
      job.cancelSettle = null;
      void this.#run(job);
    }, this.#settleMs);
  }

  /**
   * A request typed in the chat. It takes the same path as a voice delegation
   * (interpretation, the on-screen gesture, validation, apply) and competes
   * with one for the single job slot, but its result comes back here rather
   * than being spoken.
   *
   * @returns The reply, or null when the request was cancelled or superseded
   *   before it finished.
   */
  async handleTypedRequest(text: string): Promise<string | null> {
    if (this.#disposed) return null;
    let replyText: string | null = null;
    const job = this.#startJob({
      delegationId: `typed_${this.#seq + 1}`,
      offsetMs: 0,
      typed: text,
      injectId: null,
      reply: (reply) => {
        replyText = reply;
      },
    });
    await this.#run(job);
    return job.cancelled ? null : replyText;
  }

  /**
   * Makes a job current. One task at a time: a newer request replaces the
   * older one, and the older one is explicitly cancelled rather than left to
   * land later.
   */
  #startJob(fields: Pick<Job, "delegationId" | "offsetMs" | "typed" | "injectId" | "reply">): Job {
    this.#stopCues?.();
    if (this.#current) {
      this.#cancelJob(this.#current, "superseded by a newer request");
      this.#log({
        delegationId: this.#current.delegationId,
        outcome: "superseded",
        detail: `by ${fields.delegationId}`,
      });
    }

    this.#seq += 1;
    const job: Job = {
      ...fields,
      seq: this.#seq,
      cancelled: false,
      reason: null,
      cancelSettle: null,
      aborter: new AbortController(),
    };
    this.#current = job;
    this.#setBusy(true);
    return job;
  }

  async #run(job: Job): Promise<void> {
    if (this.#isStale(job)) {
      this.#log({ delegationId: job.delegationId, outcome: "cancelled", detail: job.reason ?? "stale" });
      return;
    }

    const snapshot = this.#host.snapshot();
    const utterance = job.typed ?? this.#transcript.userRequestAt(job.offsetMs);

    if (utterance.trim() === "") {
      // No transcript to reconstruct from: say so instead of inventing a task.
      this.#log({ delegationId: job.delegationId, outcome: "no_transcript", detail: `offset=${job.offsetMs}` });
      job.reply("I did not catch that clearly enough to act on it. Could you say it again?");
      this.#finish(job);
      return;
    }

    // A plan is only valid for the board state it was made against. Some
    // plans are derived from that state (for example "acknowledge the alert"
    // resolves to whichever alert is open), so if the user changes the board
    // while interpretation is in flight, the plan is replanned once against
    // the new state, and refused outright if the board is still moving.
    const first = await this.#interpretOnce(job, utterance, snapshot);
    if (first.status !== "ok") return;

    let interpreted = first.interpreted;
    let plannedRevision = snapshot.revision;
    let currentRevision = this.#host.snapshot().revision;

    if (currentRevision !== plannedRevision) {
      this.#log({
        delegationId: job.delegationId,
        outcome: "rejected",
        detail: `board moved ${plannedRevision}->${currentRevision} during interpretation; replanning`,
      });
      const replanSnapshot = this.#host.snapshot();
      const second = await this.#interpretOnce(job, utterance, replanSnapshot);
      if (second.status !== "ok") return;
      interpreted = second.interpreted;
      plannedRevision = replanSnapshot.revision;
      currentRevision = this.#host.snapshot().revision;

      if (currentRevision !== plannedRevision) {
        // Still changing. Acting now would apply a plan to state it was not
        // made for, so the request is explicitly rejected instead.
        this.#log({
          delegationId: job.delegationId,
          outcome: "rejected",
          detail: `stale plan: board moved again ${plannedRevision}->${currentRevision}`,
        });
        job.reply(BOARD_MOVED_REPLY);
        this.#syncContext(job.injectId);
        this.#finish(job);
        return;
      }
    }

    switch (interpreted.kind) {
      case "unsupported": {
        this.#log({ delegationId: job.delegationId, outcome: "unsupported", detail: interpreted.reason });
        job.reply(interpreted.reason);
        // Session-wide guardrail, so the model does not later imply it worked.
        this.#inject(
          "instructions",
          null,
          "Mica did not perform that request and cannot. Do not say or imply that it was done, scheduled or queued.",
        );
        this.#remember(utterance, null, "unsupported", interpreted.reason);
        break;
      }
      case "unclear": {
        this.#log({ delegationId: job.delegationId, outcome: "unclear", detail: interpreted.hint });
        job.reply(interpreted.hint);
        this.#inject("thinking", job.injectId, SUPPORTED_REQUEST_SUMMARY);
        this.#remember(utterance, null, "unclear", interpreted.hint);
        break;
      }
      case "action": {
        // Carry the change out on screen first: Skye's cursor clicks through
        // the real controls. Applying it afterwards is the guarantee; every
        // action is idempotent, so it changes nothing when the clicks already
        // did the job. Reads have nothing to click.
        //
        // The board is not re-checked here as it is after interpretation:
        // the gesture's own clicks move it, so a moved board is expected.
        // A write may need the user's say-so first: asked before anything
        // moves on screen, and a no stops the request here.
        const write = ACTION_KIND[interpreted.action.name] === "write";
        const confirm = this.#host.confirm;
        if (confirm && write) {
          let approved = false;
          try {
            approved = await confirm.call(this.#host, interpreted.action, job.aborter.signal);
          } catch {
            approved = false;
          }
          if (this.#isStale(job)) {
            this.#log({ delegationId: job.delegationId, outcome: "cancelled", detail: job.reason ?? "stale after confirm" });
            return;
          }
          if (!approved) {
            const declined = "Okay, I left it as it was. Nothing changed.";
            this.#log({ delegationId: job.delegationId, outcome: "rejected", detail: `${interpreted.action.name} declined by the user` });
            job.reply(declined);
            this.#remember(utterance, interpreted.action.name, "rejected", declined);
            this.#finish(job);
            return;
          }
        }
        // Whatever Skye's cursor and the apply change on the board from here
        // waits there for approval, even what a job stopped part way changed.
        const finishChange = write ? this.#host.beginChange?.(interpreted.action) : undefined;
        // What was open before Skye's cursor changes anything, so the apply
        // can say what the change cleared and offer the next thing.
        const openBefore = openWork(this.#host);
        const gesture = this.#host.gesture;
        if (gesture && write) {
          try {
            await gesture.call(this.#host, interpreted.action, job.aborter.signal);
          } catch (error) {
            // A gesture that fails to play must not block the change itself,
            // but it is logged: the change then lands all at once, unanimated.
            this.#log({
              delegationId: job.delegationId,
              outcome: "gesture_failed",
              detail: `${interpreted.action.name}: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
          if (this.#isStale(job)) {
            finishChange?.();
            this.#log({ delegationId: job.delegationId, outcome: "cancelled", detail: job.reason ?? "stale after gesture" });
            return;
          }
        }
        const result = applyAppAction(interpreted.action, this.#host, openBefore);
        const waiting = finishChange?.() ?? null;
        if (!result.ok) {
          // Re-validation inside apply failed: the board changed underneath.
          this.#log({ delegationId: job.delegationId, outcome: "rejected", detail: `${result.code}: ${result.message}` });
          job.reply(withWait(job, result.message, waiting));
          this.#remember(utterance, interpreted.action.name, "rejected", result.message);
          break;
        }
        this.#log({
          delegationId: job.delegationId,
          outcome: "applied",
          detail: `${interpreted.action.name} (${ACTION_KIND[interpreted.action.name]})`,
        });
        const told = tellApplied(job, result, waiting);
        job.reply(told.reply);
        this.#armCues(job, told.cues ?? [], told.whileTalking);
        // A suggestion is remembered with what it offered, for a "yes" to carry out.
        this.#remember(utterance, interpreted.action.name, "applied", told.reply, told.proposal);
        // Resynchronise context after a change, so later questions are
        // answered against what is now on screen.
        if (result.mutated) this.#syncContext(job.injectId);
        break;
      }
    }

    this.#finish(job);
  }

  /**
   * One interpretation attempt. Returns "stale" when the job was cancelled or
   * superseded across the await, in which case nothing is spoken and nothing
   * is applied; "failed" when the interpreter itself errored.
   */
  async #interpretOnce(
    job: Job,
    utterance: string,
    snapshot: ReturnType<OperationsHost["snapshot"]>,
  ): Promise<{ status: "ok"; interpreted: InterpretedRequest } | { status: "stale" } | { status: "failed" }> {
    let interpreted: InterpretedRequest;
    try {
      interpreted = await this.#interpreter.interpret(
        {
          utterance,
          snapshot,
          // Dialogue and recent outcomes, so a request can be a correction
          // ("no, the departure") or a follow-up ("select it") rather than a
          // standalone command.
          transcript: this.#transcript.transcriptText(),
          taskHistory: this.#history,
        },
        job.aborter.signal,
      );
    } catch (error) {
      if (this.#isStale(job)) {
        this.#log({ delegationId: job.delegationId, outcome: "cancelled", detail: job.reason ?? "aborted" });
        return { status: "stale" };
      }
      this.#log({
        delegationId: job.delegationId,
        outcome: "rejected",
        detail: `interpreter failed: ${error instanceof Error ? error.message : "unknown"}`,
      });
      job.reply("Something went wrong working that out in Mica. Please try again.");
      this.#finish(job);
      return { status: "failed" };
    }

    // The await above is where a hangup or a newer request lands. A stale job
    // must not reach the app or speak.
    if (this.#isStale(job)) {
      this.#log({ delegationId: job.delegationId, outcome: "cancelled", detail: job.reason ?? "stale after interpret" });
      return { status: "stale" };
    }
    return { status: "ok", interpreted };
  }

  /** Keeps the last few outcomes so the next request can correct or extend one. */
  #remember(
    utterance: string,
    action: string | null,
    outcome: TaskHistoryEntry["outcome"],
    result: string,
    proposal?: TaskHistoryEntry["proposal"],
  ): void {
    this.#history.push(proposal ? { utterance, action, outcome, result, proposal } : { utterance, action, outcome, result });
    if (this.#history.length > MAX_TASK_HISTORY) this.#history.shift();
  }

  /** Recent finished tasks, oldest first. */
  get taskHistory(): readonly TaskHistoryEntry[] {
    return this.#history;
  }

  #finish(job: Job): void {
    if (this.#current === job) {
      this.#current = null;
      this.#setBusy(false);
    }
  }

  #cancelJob(job: Job, reason: string): void {
    job.cancelled = true;
    job.reason = reason;
    job.cancelSettle?.();
    job.cancelSettle = null;
    // Stops an in-flight backend interpretation rather than only ignoring it.
    job.aborter.abort(reason);
  }

  /**
   * The chat's Stop: cancels the current job only if it is a typed request,
   * so stopping a typed reply can never cancel work a voice request started.
   * The cancelled job resolves to null and never reaches the app.
   *
   * @returns Whether a typed request was cancelled.
   */
  cancelTyped(reason = "stopped from the chat"): boolean {
    const job = this.#current;
    if (!job || job.typed === null) return false;
    this.#cancelJob(job, reason);
    this.#log({ delegationId: job.delegationId, outcome: "cancelled", detail: reason });
    this.#current = null;
    this.#setBusy(false);
    return true;
  }

  /**
   * Cancels in-flight work. Called on hangup and session close — never on
   * mute, and never because the agent was interrupted mid-sentence.
   */
  cancelAll(reason: string): void {
    this.#stopCues?.();
    if (this.#current) {
      this.#cancelJob(this.#current, reason);
      this.#log({ delegationId: this.#current.delegationId, outcome: "cancelled", detail: reason });
      this.#current = null;
    }
    this.#cancelContextSync?.();
    this.#cancelContextSync = null;
    this.#setBusy(false);
  }

  /* ----------------------------------------------------------------- cues */

  /** Ends the cues of the last reply, if any are still waiting. */
  #stopCues: (() => void) | null = null;

  /**
   * Points at what a reply talks about as Skye gets to it, not before: each
   * cue selects its alert's flights when one of its words turns up in what
   * Skye is heard saying, so a summary she gives first selects nothing. The
   * one named most recently is shown. `talk` (the alerts window) shows from
   * when she starts speaking until she has been quiet a few seconds. A newer
   * request ends them. A typed reply shows all at once, so its subject and
   * the first thing it names are shown with it, for a while.
   */
  #armCues(job: Job, cues: readonly SpeechCue[], talk?: WhileTalking): void {
    this.#stopCues?.();
    if (cues.length === 0 && !talk) return;
    let talking = false;
    let cancelQuiet: (() => void) | null = null;
    let unsubscribe: () => void = () => undefined;
    const stop = () => {
      unsubscribe();
      cancelExpiry();
      cancelQuiet?.();
      if (talking) talk?.end();
      talking = false;
      if (this.#stopCues === stop) this.#stopCues = null;
    };
    const begin = () => {
      if (talking) return;
      talking = true;
      talk?.start();
    };
    if (job.typed !== null) {
      begin();
      cues[0]?.show();
      const cancelExpiry = this.#schedule(stop, TYPED_SHOW_MS);
      const stopTyped = () => {
        cancelExpiry();
        if (talking) talk?.end();
        talking = false;
        if (this.#stopCues === stopTyped) this.#stopCues = null;
      };
      this.#stopCues = stopTyped;
      return;
    }
    const words = cues.map((cue) => cue.words.map(squashWords).filter((word) => word.length >= 3));
    let heard = "";
    let shown: SpeechCue | null = null;
    unsubscribe = this.#transcript.subscribe((role, text) => {
      if (role !== "agent") return;
      // Skye has started talking about it; it stays shown until she goes quiet.
      begin();
      cancelQuiet?.();
      cancelQuiet = this.#schedule(stop, QUIET_MS);
      heard += text;
      const said = squashWords(heard);
      let latest = -1;
      let named: SpeechCue | null = null;
      cues.forEach((cue, index) => {
        for (const word of words[index]) {
          const at = said.lastIndexOf(word);
          if (at > latest) {
            latest = at;
            named = cue;
          }
        }
      });
      if (named && named !== shown) {
        shown = named;
        (named as SpeechCue).show();
      }
    });
    const cancelExpiry = this.#schedule(stop, CUE_WINDOW_MS);
    this.#stopCues = stop;
  }

  /* -------------------------------------------------------------- context */

  /** Sends the board context now. Session-wide context uses a null delegation id. */
  #syncContext(delegationId: string | null): void {
    const snapshot = this.#host.snapshot();
    this.#lastSyncedRevision = snapshot.revision;
    this.#inject("thinking", delegationId, describeSnapshot(snapshot));
    this.#log({ delegationId, outcome: "context_sync", detail: `revision=${snapshot.revision}` });
  }

  /** Initial context, sent once the session is running. */
  syncNow(): void {
    if (this.#disposed) return;
    this.#syncContext(null);
  }

  /**
   * The user changed the board by hand. This never cancels pending work: it
   * only re-sends context, debounced, so a burst of clicking does not turn
   * into a burst of injections.
   */
  noteContextChange(revision: number): void {
    if (this.#disposed || revision === this.#lastSyncedRevision) return;
    this.#cancelContextSync?.();
    this.#cancelContextSync = this.#schedule(() => {
      this.#cancelContextSync = null;
      if (this.#disposed) return;
      this.#syncContext(null);
    }, this.#contextSyncMs);
  }

  /** Clears per-session state so the next call starts clean. */
  reset(): void {
    this.cancelAll("session reset");
    this.#seen.clear();
    this.#history = [];
    this.#lastSyncedRevision = null;
  }

  dispose(): void {
    this.cancelAll("disposed");
    this.#disposed = true;
  }
}
