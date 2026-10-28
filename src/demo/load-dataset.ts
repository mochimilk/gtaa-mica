import { DEMO_DATA, DEMO_DOMAIN } from "../stand-timeline-demo/demoData";
import { SYNTHETIC_DATE } from "../stand-timeline-demo/syntheticFixture";
import { OPS_FLIGHTS, OPS_FLIGHTS_BY_ID, ARRIVALS, DEPARTURES, OPS_ALERTS } from "../operations/operationsData";
import type { DemoDataset } from "./dataset";
import { parseDemoPreferences, type DemoPreferences } from "./preferences";
import { validateCapacitySnapshot } from "./capacity-evaluation";
import { validateAtlas } from "./atlas-evaluation";
import { validateAccommodation } from "./accommodation-evaluation";
import { adaptPreparedScenario } from "./prepared-adapter";
import { validateTowWindows } from "./tow-windows-evaluation";
import { DEFAULT_BUFFER_PROFILE } from "./buffer-evaluation";
import { DEFAULT_GATE_WAIT_PROFILE } from "./gate-wait-evaluation";

export const ORIGINAL_DATASET: DemoDataset = {
  id: "original", label: "Original demo", date: SYNTHETIC_DATE,
  subtitle: "Generic stand-timeline starter. Not an ARIS or GateView replica.",
  timeBasis: "estimated", timeline: DEMO_DATA, domain: DEMO_DOMAIN,
  flights: OPS_FLIGHTS, flightsById: OPS_FLIGHTS_BY_ID, arrivals: ARRIVALS, departures: DEPARTURES, alerts: OPS_ALERTS,
};

export async function loadDemoDataset(requested: DemoPreferences): Promise<DemoDataset> {
  const preferences = parseDemoPreferences(requested);
  if (preferences.source === "original") return ORIGINAL_DATASET;
  if (preferences.source === "gtaa") {
    const [module, { validatePreparedSnapshot }] = await Promise.all([
      import("./prepared/gtaa/full-day.json"), import("./validate-prepared"),
    ]);
    const snapshot = validatePreparedSnapshot(module.default, { airportId: "gtaa", caseId: preferences.scenario });
    return adaptPreparedScenario(snapshot, preferences.variant);
  }
  const [module, capacityModule, atlasModule, accommodationModule, towModule, { validatePreparedSnapshot }] = await Promise.all([
    preferences.scenario === "comfortable" ? import("./prepared/comfortable.json")
      : preferences.scenario === "constrained" ? import("./prepared/constrained.json") : import("./prepared/full-day.json"),
    preferences.scenario === "comfortable" ? import("./prepared/comfortable.capacity.json")
      : preferences.scenario === "constrained" ? import("./prepared/constrained.capacity.json") : import("./prepared/full-day.capacity.json"),
    preferences.scenario === "comfortable" ? import("./prepared/comfortable.atlas.json")
      : preferences.scenario === "constrained" ? import("./prepared/constrained.atlas.json") : import("./prepared/full-day.atlas.json"),
    preferences.scenario === "comfortable" ? import("./prepared/comfortable.accommodation.json")
      : preferences.scenario === "constrained" ? import("./prepared/constrained.accommodation.json") : import("./prepared/full-day.accommodation.json"),
    preferences.scenario === "comfortable" ? import("./prepared/comfortable.tow-windows.json")
      : preferences.scenario === "constrained" ? import("./prepared/constrained.tow-windows.json") : import("./prepared/full-day.tow-windows.json"),
    import("./validate-prepared"),
  ]);
  const snapshot = validatePreparedSnapshot(module.default, { airportId: "contoso", caseId: preferences.scenario });
  const capacity = await validateCapacitySnapshot(capacityModule.default, snapshot);
  const atlas = await validateAtlas(atlasModule.default, capacity);
  const accommodation = await validateAccommodation(accommodationModule.default, snapshot, capacity);
  const towWindows = await validateTowWindows(towModule.default, snapshot, capacity);
  return {
    ...adaptPreparedScenario(snapshot, preferences.variant, towWindows.airport.name),
    prepared: {
      snapshot, variant: preferences.variant, capacity, atlas, accommodation, towWindows,
      reviewProfiles: { buffers: DEFAULT_BUFFER_PROFILE, waiting: DEFAULT_GATE_WAIT_PROFILE },
    },
  };
}
