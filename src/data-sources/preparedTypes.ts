import type { TimelineRow } from "../stand-timeline";
import type { SyntheticTurn } from "../stand-timeline-demo/syntheticFixture";

export type PlanVariant = "baseline" | "tow-options";

export interface PreparedPlan {
  solver_status: "optimal" | "feasible";
  request_fingerprint: string;
  covered_flight_count: number;
  generated_movement_count: number;
  stand_validation_passed: true;
  stays: {
    id: string;
    visitId: string;
    rowId: string;
    start: string;
    end: string;
    arrivalFlightId?: string;
    departureFlightId?: string;
    towIn: boolean;
    towOut: boolean;
  }[];
}

export interface PreparedScenario {
  schema_version: "1.0.0";
  case_id: "comfortable" | "constrained" | "full-day";
  demand_id: string;
  airport?: { id: string; name: string; time_zone: string };
  plan_window: { start: string; end: string };
  rows: TimelineRow[];
  visits: Omit<SyntheticTurn, "stays">[];
  flights: {
    id: string;
    visitId: string;
    direction: "arrival" | "departure";
    flight: string;
    routeEnd: string;
    scheduled: string;
  }[];
  variants: Record<PlanVariant, PreparedPlan>;
}
