import { DEMO_DATA, DEMO_DOMAIN } from "../stand-timeline-demo/demoData";
import { SYNTHETIC_DATE } from "../stand-timeline-demo/syntheticFixture";
import { OPS_FLIGHTS, OPS_FLIGHTS_BY_ID, ARRIVALS, DEPARTURES, OPS_ALERTS } from "../operations/operationsData";
import type { DemoDataset } from "./dataset";
import type { DemoPreferences } from "./preferences";
import { validateCapacitySnapshot } from "./capacity-evaluation";
import { validateAtlas } from "./atlas-evaluation";
import { validateAccommodation } from "./accommodation-evaluation";
import { adaptPreparedScenario } from "./prepared-adapter";

export const ORIGINAL_DATASET: DemoDataset = {
  id: "original", label: "Original demo", date: SYNTHETIC_DATE,
  subtitle: "Generic stand-timeline starter. Not an ARIS or GateView replica.",
  timeBasis: "estimated", timeline: DEMO_DATA, domain: DEMO_DOMAIN,
  flights: OPS_FLIGHTS, flightsById: OPS_FLIGHTS_BY_ID, arrivals: ARRIVALS, departures: DEPARTURES, alerts: OPS_ALERTS,
};

export async function loadDemoDataset(preferences: DemoPreferences): Promise<DemoDataset> {
  if (preferences.source === "original") return ORIGINAL_DATASET;
  const [module, capacityModule, atlasModule, accommodationModule, { validatePreparedSnapshot }] = await Promise.all([
    preferences.scenario === "comfortable" ? import("./prepared/comfortable.json")
      : preferences.scenario === "constrained" ? import("./prepared/constrained.json") : import("./prepared/full-day.json"),
    preferences.scenario === "comfortable" ? import("./prepared/comfortable.capacity.json")
      : preferences.scenario === "constrained" ? import("./prepared/constrained.capacity.json") : import("./prepared/full-day.capacity.json"),
    preferences.scenario === "comfortable" ? import("./prepared/comfortable.atlas.json")
      : preferences.scenario === "constrained" ? import("./prepared/constrained.atlas.json") : import("./prepared/full-day.atlas.json"),
    preferences.scenario === "comfortable" ? import("./prepared/comfortable.accommodation.json")
      : preferences.scenario === "constrained" ? import("./prepared/constrained.accommodation.json") : import("./prepared/full-day.accommodation.json"),
    import("./validate-prepared"),
  ]);
  const snapshot = validatePreparedSnapshot(module.default);
  if (snapshot.case_id !== preferences.scenario) throw new Error("Prepared demo case does not match the selected scenario.");
  const capacity = await validateCapacitySnapshot(capacityModule.default, snapshot);
  const atlas = await validateAtlas(atlasModule.default, capacity);
  const accommodation = await validateAccommodation(accommodationModule.default, snapshot, capacity);
  return {
    ...adaptPreparedScenario(snapshot, preferences.variant),
    prepared: { snapshot, variant: preferences.variant, capacity, atlas, accommodation },
  };
}
