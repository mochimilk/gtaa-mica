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

/** How an entry's status reads: in the warning colour while a teammate still has to approve, the brand's once it is the user's turn. */
export type ApprovalTone = "warning" | "brand" | "success" | "subtle";

/**
 * Where an entry stands, as the list and the page's header say it: "Needs
 * baggage", "Calling Travis", "Travis is reviewing", "Ready for your
 * approval"; "Approved 14:32", "Cancelled". `review` is what waits now, and
 * `calling` everyone being called.
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
  if (first.state === "asked") return { text: `${name} is reviewing`, tone: "warning" };
  return calling.includes(first.name) ? { text: `Calling ${name}`, tone: "warning" } : { text: `Needs ${first.expertise}`, tone: "warning" };
}
