import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@fluentui/react-components";
import type { DecisionBrief } from "./decision-brief";

export const decisionMinutes = (value: number | null) => value === null ? "N/A" : `${Number(value.toFixed(2))} min`;

export function DecisionMeasures({ brief, label = "Plan decision consequences" }: { brief: DecisionBrief; label?: string }) {
  const { before, after, beforeBuffers, afterBuffers, beforeWaiting, afterWaiting, common } = brief;
  const rows: (string | number)[][] = [
    ["Assigned visits / demand visits", `${before.assignedVisitIds.size} / ${before.scenario.visits.length}`,
      `${after.assignedVisitIds.size} / ${after.scenario.visits.length}`],
    ["Existing assigned visits retained", before.assignedVisitIds.size, brief.retainedIds.length],
    ["Previously unresolved visits accommodated", 0, brief.gainedIds.length],
    ["New services added after reference", 0, brief.addedIds.length],
    ["Existing unresolved visits", before.unassignedVisits, brief.originalUnresolvedAfter],
    ["Existing assigned visits lost", 0, brief.lostIds.length],
    ["Retained visits with assignment changes", 0, brief.changedIds.length],
    ["Existing flight times changed", 0, brief.retimedFlightIds.length],
    ["Generated tow movements", before.plan.generated_movement_count, after.plan.generated_movement_count],
    ["Measured stand handovers", beforeBuffers.summary.handover_count, afterBuffers.summary.handover_count],
    [`Tight handovers (<${brief.bufferProfile.threshold_minutes} min)`, beforeBuffers.summary.tight_count, afterBuffers.summary.tight_count],
    ["Minimum scheduled stand buffer", decisionMinutes(beforeBuffers.summary.minimum_minutes), decisionMinutes(afterBuffers.summary.minimum_minutes)],
    [`Synthetic waiting, ${common.arrivalIds.length} common assessed arrivals`, decisionMinutes(common.beforeMinutes), decisionMinutes(common.afterMinutes)],
    ["Assessed arrivals", beforeWaiting.summary.assessed_arrivals, afterWaiting.summary.assessed_arrivals],
    ["Unassessed arrivals (not zero waiting)", beforeWaiting.summary.unassessed_arrivals, afterWaiting.summary.unassessed_arrivals],
  ];
  if (brief.option) rows.push(["Incoming arrival waiting estimate", "Not in reference",
    brief.incomingWait === null ? "Unassessed" : decisionMinutes(brief.incomingWait)]);
  return <>
    <Table size="small" aria-label={label}>
      <TableHeader><TableRow><TableHeaderCell>Measure</TableHeaderCell><TableHeaderCell>Reference</TableHeaderCell><TableHeaderCell>Alternative</TableHeaderCell></TableRow></TableHeader>
      <TableBody>{rows.map(([name, reference, alternative]) => <TableRow key={name}>
        <TableCell>{name}</TableCell><TableCell>{reference}</TableCell><TableCell>{alternative}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
    <p>These are consequences, not an overall capacity or resilience score. Buffer handover populations can change; their counts and minima
      are not like-for-like improvement deltas. Waiting totals compare only the same assessed arrival identities in both plans;
      excluded or unassessed arrivals are not zero waiting. An incoming service is shown separately.
      N/A means no measurement or no common assessed population. The buffer threshold is reporting-only, not a hard operating minimum.</p>
  </>;
}
