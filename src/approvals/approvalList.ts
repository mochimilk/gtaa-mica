// What the call's shared screen shows (ApprovalsCall), from the Outputs list
// (../operations/outputs): Skye's changes that had to be approved. First what
// is waiting now, as one: every request whose changes wait together
// (skyeReview holds them so), under the newest. Then what was decided, newest
// first: each request approved, with its logged decision, or cancelled. The
// user's own changes need nobody's approval and are not listed, nor is a
// request whose changes Skye put back herself.
import { describeRequest, formatLogTime, type OutputRequest, type OutputStep } from "../operations/outputs";
import type { SkyeReview } from "../operations/skyeReview";

export type ApprovalEntry = {
  /** Its newest request's id: kept once it is decided, so the page stays on it. */
  id: string;
  /** Newest first; more than one only while changes for several requests wait together. */
  requests: readonly OutputRequest[];
  /** Waiting to be approved; otherwise decided: approved (its newest request's `decision`) or undone. */
  waiting: boolean;
};

export function approvalEntries(requests: readonly OutputRequest[]): ApprovalEntry[] {
  const skye = requests.filter((request) => request.actor === "skye" && !request.working);
  const waiting = skye.filter((request) => describeRequest(request).waiting);
  const decided = skye.filter(
    (request) =>
      !describeRequest(request).waiting && (!!request.decision || request.steps.some((step) => step.status === "undone")),
  );
  return [
    ...(waiting.length > 0 ? [{ id: waiting[0].id, requests: waiting, waiting: true }] : []),
    ...decided.map((request) => ({ id: request.id, requests: [request], waiting: false })),
  ];
}

/** The pieces an entry decides on: those still waiting, or, once decided, every piece it changed. */
export const entrySteps = (entry: ApprovalEntry): OutputStep[] =>
  entry.requests.flatMap((request) =>
    entry.waiting
      ? request.steps.filter((step) => step.status === "pending-approval" || step.status === "waiting")
      : request.steps,
  );

/**
 * The review's states, in order, for the shared screen's foot: `done` once
 * passed, `current` the one it is at, otherwise yet to come. Pending review,
 * then who approved it and when, then the user's, then applied. With nobody to
 * review it first, only the last two.
 */
export type ReviewStep = { id: string; label: string; state: "done" | "current" | "todo" };

export function reviewSteps(entry: ApprovalEntry, review: SkyeReview | null): ReviewStep[] {
  const decision = entry.requests[0]?.decision;
  const applied = !entry.waiting && !!decision;
  const signoffs = review?.signoffs ?? decision?.signoffs ?? [];
  const reviewers = signoffs.map((signoff) => {
    const at = "at" in signoff ? signoff.at : undefined;
    return { name: signoff.name, at, approved: !!at };
  });
  const allApproved = applied || reviewers.every((reviewer) => reviewer.approved);
  const steps: ReviewStep[] = [];
  if (reviewers.length > 0) {
    steps.push({ id: "pending", label: "Pending review", state: allApproved ? "done" : "current" });
    for (const reviewer of reviewers) {
      steps.push({
        id: `approved-${reviewer.name}`,
        label: reviewer.approved
          ? `Approved by ${reviewer.name}${reviewer.at ? ` · ${formatLogTime(reviewer.at)}` : ""}`
          : `Approved by ${reviewer.name.split(" ")[0]}`,
        state: reviewer.approved ? "done" : "todo",
      });
    }
  }
  steps.push({ id: "ready", label: "Ready for your approval", state: applied ? "done" : allApproved ? "current" : "todo" });
  steps.push({
    id: "applied",
    label: applied && decision ? `Applied · ${formatLogTime(decision.at)}` : "Applied",
    state: applied ? "done" : "todo",
  });
  return steps;
}

/** How an entry's status reads: in the warning colour while a teammate still has to approve, the brand's once it is the user's turn. */
export type ApprovalTone = "warning" | "brand" | "success" | "subtle";

/**
 * Where an entry stands, as the shared screen says it, in one place throughout:
 * "Needs baggage", "Calling Travis", "Travis joined", "Skye is presenting changes", "Travis is
 * asking Skye", "Skye is answering Travis", "Waiting for Travis", "Ready for
 * your approval"; "Approved 14:32", "Cancelled". `review` is what waits now, and
 * `calling` everyone being called. Only their approval moves it to the user: not
 * anything they say.
 */
export function approvalStatus(
  entry: ApprovalEntry,
  review: SkyeReview | null,
  calling: readonly string[],
): { text: string; tone: ApprovalTone } {
  const decision = entry.requests[0]?.decision;
  if (!entry.waiting) return decision ? { text: `Approved ${formatLogTime(decision.at)}`, tone: "success" } : { text: "Cancelled", tone: "subtle" };
  const first = review?.signoffs.find((signoff) => signoff.state !== "approved");
  if (!first) return { text: "Ready for your approval", tone: "brand" };
  const name = first.name.split(" ")[0];
  if (first.state === "asked") {
    switch (first.stage) {
      case "joined":
        return { text: `${name} joined`, tone: "warning" };
      case "presenting":
        return { text: "Skye is presenting changes", tone: "warning" };
      case "asking":
        return { text: `${name} is asking Skye`, tone: "warning" };
      case "answering":
        return { text: `Skye is answering ${name}`, tone: "warning" };
      case "deciding":
        return { text: `Waiting for ${name}`, tone: "warning" };
      default:
        return { text: `${name} is reviewing`, tone: "warning" };
    }
  }
  return calling.includes(first.name) ? { text: `Calling ${name}`, tone: "warning" } : { text: `Needs ${first.expertise}`, tone: "warning" };
}
