import { accommodationImpact, type PreparedAccommodation } from "./accommodation-evaluation";
import { DEFAULT_GATE_WAIT_PROFILE } from "./gate-wait-evaluation";
import type { PreparedScenario } from "./dataset";
import type { PlanVariant } from "./preferences";

export function accommodationChoices(snapshot: PreparedScenario, evidence: PreparedAccommodation, variant: PlanVariant, retainedIds: string[] = []) {
  const row = (id: string) => {
    const stand = snapshot.rows.find(item => item.id === id);
    if (!stand) throw new Error(`Unknown accommodation choice stand: ${id}`);
    return stand.label;
  };
  const candidates = evidence.variants[variant].options.map(option => {
    const move = option.moves[0];
    const stay = move && snapshot.variants[variant].stays.find(item => item.id === move.stay_id);
    const visit = stay && snapshot.visits.find(item => item.turnId === stay.visitId);
    if (move && !visit) throw new Error("Unknown accommodation choice relocation.");
    const contact = move ? move.to_stand_contact : option.target_stand_contact;
    const strategy = `${option.kind}:${contact ? "contact" : "non-contact"}`;
    const metrics = DEFAULT_GATE_WAIT_PROFILE.assumptions.map(assumption => {
      const impact = accommodationImpact(snapshot, evidence, variant, option.id, assumption);
      return [
        impact.afterBuffers.summary.handover_count, impact.afterBuffers.summary.tight_count, impact.afterBuffers.summary.minimum_minutes,
        impact.beforeWaiting.summary.assessed_arrivals, impact.afterWaiting.summary.assessed_arrivals,
        impact.beforeWaiting.summary.unassessed_arrivals, impact.afterWaiting.summary.unassessed_arrivals,
        impact.commonExistingArrivals, impact.beforeCommonWait, impact.afterCommonWait, impact.incomingWait,
      ];
    });
    const label = move && visit
      ? `Incoming ${row(option.target_stand_id)}; move ${visit.arrFlight}/${visit.depFlight} to ${contact ? "contact" : "non-contact"} ${row(move.to_stand_id)}`
      : `Direct fit at ${contact ? "contact" : "non-contact"} ${row(option.target_stand_id)}`;
    return { option, strategy, label, movedVisit: stay?.visitId ?? null, metricKey: JSON.stringify(metrics) };
  }).sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : a.option.id < b.option.id ? -1 : a.option.id > b.option.id ? 1 : 0);
  const selected: typeof candidates = [];
  const add = (candidate: typeof candidates[number]) => { if (!selected.includes(candidate)) selected.push(candidate); };
  for (const candidate of candidates) {
    if (selected.length >= evidence.profile.max_displayed_options) break;
    if (!selected.some(item => item.strategy === candidate.strategy)) add(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= evidence.profile.max_displayed_options) break;
    if (!selected.some(item => item.metricKey === candidate.metricKey)) add(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= evidence.profile.max_displayed_options) break;
    if (candidate.movedVisit && !selected.some(item => item.movedVisit === candidate.movedVisit)) add(candidate);
  }
  for (const id of retainedIds.filter(Boolean)) {
    const candidate = candidates.find(item => item.option.id === id);
    if (!candidate) throw new Error("Unknown retained accommodation choice.");
    add(candidate);
  }
  return selected.map(candidate => ({
    option: candidate.option, label: candidate.label,
    equivalentCount: candidates.filter(item => item.option.id !== candidate.option.id && item.metricKey === candidate.metricKey).length,
  }));
}
