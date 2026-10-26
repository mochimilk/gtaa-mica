import type { DemoTimelineData, TimelineTurn } from "../stand-timeline-demo/adapter";
import type { TimelineRow } from "../stand-timeline";
import type { OpsAlert, OpsFlight } from "../operations/operationsData";
import type { PlanVariant, ScenarioId } from "./preferences";
import type { PreparedCapacity } from "./capacity-evaluation";
import type { PreparedAtlas } from "./atlas-evaluation";

export interface DemoDataset {
  id: string;
  label: string;
  date: string;
  subtitle: string;
  timeBasis: "estimated" | "scheduled";
  timeline: DemoTimelineData;
  domain: readonly [number, number];
  flights: OpsFlight[];
  flightsById: Map<string, OpsFlight>;
  arrivals: OpsFlight[];
  departures: OpsFlight[];
  alerts: OpsAlert[];
  prepared?: { snapshot: PreparedScenario; variant: PlanVariant; capacity?: PreparedCapacity; atlas?: PreparedAtlas };
}

export interface PreparedFlight {
  id: string;
  visitId: string;
  direction: "arrival" | "departure";
  flight: string;
  routeEnd: string;
  scheduled: string;
}

export interface PreparedStay {
  id: string;
  visitId: string;
  rowId: string;
  start: string;
  end: string;
  arrivalFlightId?: string;
  departureFlightId?: string;
  towIn: boolean;
  towOut: boolean;
}

export interface PreparedPlan {
  solver_status: "optimal" | "feasible";
  request_fingerprint: string;
  covered_flight_count: number;
  generated_movement_count: number;
  stand_validation_passed: true;
  stays: PreparedStay[];
}

export interface PreparedScenario {
  schema_version: "1.0.0";
  case_id: ScenarioId;
  demand_id: string;
  plan_window: { start: string; end: string };
  rows: TimelineRow[];
  visits: TimelineTurn[];
  flights: PreparedFlight[];
  variants: Record<PlanVariant, PreparedPlan>;
}
