import { validate } from "./prepared-validator.mjs";
import { adaptPreparedSchedule } from "./preparedAdapter";
import type { PreparedScenario } from "./preparedTypes";
import type { OperationsDatasetInput } from "../operations/dataset";
import { fingerprintJson, parseCapacitySnapshot } from "../overlays/capacity";
import { parseTowWindows } from "../overlays/towWindows";
import { parseAccommodation } from "../overlays/accommodation";

export interface PlanComparisonEvidence {
  schema_version: "1.0.0";
  snapshot_fingerprint: string;
  snapshot: PreparedScenario;
}

export function parsePlanComparison(value: unknown): PlanComparisonEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !("schema_version" in value) || value.schema_version !== "1.0.0" ||
      !("snapshot_fingerprint" in value) || typeof value.snapshot_fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.snapshot_fingerprint) ||
      Object.keys(value).some(key => !["schema_version", "snapshot_fingerprint", "snapshot"].includes(key)) ||
      !("snapshot" in value) || !validate(value.snapshot) || !value.snapshot.airport) {
    throw new Error("Invalid prepared plan-comparison evidence.");
  }
  return { schema_version: value.schema_version, snapshot_fingerprint: value.snapshot_fingerprint, snapshot: value.snapshot };
}

export async function preparePlanComparison(snapshot: unknown): Promise<PlanComparisonEvidence> {
  const evidence = parsePlanComparison({ schema_version: "1.0.0", snapshot_fingerprint: await fingerprintJson(snapshot), snapshot });
  const expected = { airportId: evidence.snapshot.airport!.id, caseId: evidence.snapshot.case_id };
  for (const variant of ["baseline", "tow-options"] as const) adaptPreparedSchedule(evidence.snapshot, expected, variant);
  return evidence;
}

function boardRecords(source: OperationsDatasetInput) {
  const ordered = (records: unknown[][]) => records.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([
    source.date, source.domain,
    ordered(source.timeline.rows.map(row => [row.id, row.label, row.group])),
    ordered(source.timeline.visits.map(visit => [visit.id, visit.label])),
    ordered(source.flights.map(flight => [
      flight.id, flight.visitId, flight.direction, flight.flight, flight.routeEnd, flight.estimate,
      flight.registration, flight.aircraftType, flight.occupancyId, flight.standId, flight.standStart, flight.standEnd,
      flight.unplacedStay && [flight.unplacedStay.stayId, flight.unplacedStay.start, flight.unplacedStay.end],
    ])),
    ordered([...source.timeline.occupancies, ...source.noStandStays].map(stay => [
      stay.id, stay.visitId, stay.rowId, stay.start, stay.end, stay.kind,
      source.timeline.endpoints.get(stay.id)?.start.kind, source.timeline.endpoints.get(stay.id)?.end.kind,
    ])),
  ]);
}

export function validatePlanComparisonDataset(value: unknown, source: OperationsDatasetInput, profiles: Readonly<Record<string, unknown>>) {
  const evidence = parsePlanComparison(value), snapshot = evidence.snapshot, plan = source.preparedPlan;
  if (!Object.hasOwn(profiles, "decision-review") || source.capabilities?.editStands !== false || !plan ||
      snapshot.airport!.id !== source.airportId || snapshot.case_id !== plan.caseId || snapshot.demand_id !== plan.demandId ||
      source.id !== `${plan.demandId}/${plan.variant}` ||
      snapshot.variants[plan.variant].request_fingerprint !== plan.requestFingerprint) {
    throw new Error("Plan comparison requires the matching read-only decision-review source and plan.");
  }
  const expected = { airportId: source.airportId, caseId: plan.caseId };
  const plans = {
    baseline: adaptPreparedSchedule(snapshot, expected, "baseline"),
    "tow-options": adaptPreparedSchedule(snapshot, expected, "tow-options"),
  };
  if (boardRecords(plans[plan.variant]) !== boardRecords(source)) throw new Error("Plan comparison does not match the active reference records.");
  for (const [id, parser] of [
    ["capacity", parseCapacitySnapshot], ["tow-windows", parseTowWindows], ["accommodation", parseAccommodation],
  ] as const) {
    if (!Object.hasOwn(profiles, id)) continue;
    const sidecar = parser(profiles[id]);
    if (sidecar.snapshot_fingerprint !== evidence.snapshot_fingerprint ||
        (["baseline", "tow-options"] as const).some(variant =>
          sidecar.variants[variant].request_fingerprint !== snapshot.variants[variant].request_fingerprint)) {
      throw new Error("Plan comparison and analysis evidence have different snapshot or request provenance.");
    }
  }
  return { id: `${source.airportId}:plan-comparison`, evidence, plans };
}
