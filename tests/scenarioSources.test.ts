import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSourceDataset, readSourceSelection, SCHEDULE_SOURCES, sourceSelectionUrl, validateSourceSelection } from "../src/data-sources/registry.ts";
import { createOperationsDataset } from "../src/operations/dataset.ts";
import { parseAtlas } from "../src/overlays/atlas.ts";
import { parseCapacitySnapshot } from "../src/overlays/capacity.ts";
import { parsePlanComparison } from "../src/data-sources/planComparison.ts";
import { buildPlanComparison } from "../src/overlays/planComparison.ts";
import { availableOverlays, OVERLAY_REGISTRATIONS } from "../src/overlays/registry.ts";
import { parseTowWindows } from "../src/overlays/towWindows.ts";

test("source-owned scenario options normalize defaults and round-trip every supported selection", () => {
  for (const source of SCHEDULE_SOURCES) {
    assert.equal(validateSourceSelection(source.id, "baseline").scenario, source.defaultScenario);
    for (const scenario of source.scenarios) {
      for (const plan of scenario.plans) {
        const selection = { source: source.id, scenario: scenario.id, plan };
        assert.deepEqual(validateSourceSelection(source.id, plan, scenario.id), selection);
        const url = new URL(sourceSelectionUrl(new URL("http://localhost/?theme=dark&other=keep#studio"), selection));
        assert.deepEqual(readSourceSelection(url.search), selection);
        assert.equal(url.searchParams.get("theme"), "dark");
        assert.equal(url.searchParams.get("other"), "keep");
        assert.equal(url.hash, "#studio");
      }
    }
  }
  assert.deepEqual(readSourceSelection("?source=contoso&plan=tow-options"),
    { source: "contoso", scenario: "full-day", plan: "tow-options" });
  assert.deepEqual(validateSourceSelection("fixture", "baseline"), { source: "fixture", scenario: "original", plan: "baseline" });
  assert.deepEqual(validateSourceSelection("gtaa", "baseline"), { source: "gtaa", scenario: "full-day", plan: "baseline" });
});

test("unknown scenarios and incompatible airport/scenario/plan combinations fail explicitly", async () => {
  for (const [source, scenario, plan] of [
    ["contoso", "missing", "baseline"], ["contoso", "", "baseline"], ["contoso", "original", "baseline"],
    ["gtaa", "comfortable", "baseline"], ["gtaa", "constrained", "tow-options"],
    ["fixture", "full-day", "baseline"], ["fixture", "original", "tow-options"],
    ["contoso", "constrained", "unknown"], ["missing", "full-day", "baseline"],
  ]) {
    const query = `?source=${source}&scenario=${scenario}&plan=${plan}`;
    assert.throws(() => readSourceSelection(query), /Unknown/);
  }
  await assert.rejects(loadSourceDataset({ source: "gtaa", scenario: "constrained", plan: "baseline" }), /Unknown/);
  assert.throws(() => sourceSelectionUrl(new URL("http://localhost/"), { source: "fixture", scenario: "constrained", plan: "baseline" }), /Unknown/);
});

for (const [scenario, visits, baselineAssigned, movements] of [
  ["comfortable", 36, 36, 0], ["constrained", 41, 40, 2], ["full-day", 160, 149, 0],
] as const) {
  for (const plan of ["baseline", "tow-options"] as const) {
    test(`${scenario}/${plan} loads matching evidence and exact coverage without mutating the active board`, async () => {
      const dataset = await loadSourceDataset({ source: "contoso", scenario, plan });
      assert.equal(dataset.preparedPlan!.caseId, scenario);
      assert.equal(dataset.preparedPlan!.variant, plan);
      assert.equal(dataset.timeline.visits.length, visits);
      assert.equal(dataset.flights.length, visits * 2);
      assert.equal(dataset.capabilities.editStands, false);
      assert.match(dataset.label, new RegExp(scenario.replaceAll("-", " "), "i"));
      assert.deepEqual(availableOverlays(dataset).map(item => item.id), OVERLAY_REGISTRATIONS.map(item => item.id));
      const overlays = dataset.overlays!;
      assert.equal(overlays.datasetId, dataset.id);
      for (const evidence of [
        parseCapacitySnapshot(overlays.profiles.capacity),
        parseTowWindows(overlays.profiles["tow-windows"]),
        parseAtlas(overlays.companions!["capacity-atlas"]),
      ]) {
        assert.equal(evidence.case_id, scenario);
        assert.equal(evidence.demand_id, dataset.preparedPlan!.demandId);
        assert.equal(evidence.variants[plan].request_fingerprint, dataset.preparedPlan!.requestFingerprint);
      }
      const comparisonEvidence = parsePlanComparison(overlays.companions!["plan-comparison"]);
      assert.equal(comparisonEvidence.snapshot.case_id, scenario);
      const before = JSON.stringify([dataset.flights, dataset.timeline.occupancies, dataset.timeline.visits]);
      const comparison = buildPlanComparison(dataset)!;
      const towAssigned = scenario === "constrained" ? 41 : baselineAssigned;
      assert.equal(comparison.reference.coverage.assignedVisits, plan === "baseline" ? baselineAssigned : towAssigned);
      assert.equal(comparison.alternative.coverage.assignedVisits, plan === "baseline" ? towAssigned : baselineAssigned);
      assert.equal(comparison.reference.generatedMovements, plan === "baseline" ? 0 : movements);
      assert.equal(comparison.alternative.generatedMovements, plan === "baseline" ? movements : 0);
      assert.equal(comparison.gainedIds.length, scenario === "constrained" && plan === "baseline" ? 1 : 0);
      assert.equal(comparison.lostIds.length, scenario === "constrained" && plan === "tow-options" ? 1 : 0);
      assert.equal(dataset.noStandStays.length, visits - comparison.reference.coverage.assignedVisits);
      if (scenario === "constrained") {
        assert.ok(comparison.changes.some(change => (plan === "baseline" ? change.afterStays : change.beforeStays).length === 3));
      } else {
        assert.deepEqual(comparison.changedIds, []);
      }
      assert.equal(JSON.stringify([dataset.flights, dataset.timeline.occupancies, dataset.timeline.visits]), before);
    });
  }
}

test("analysis evidence from another scenario cannot be attached to a valid board", async () => {
  const comfortable = await loadSourceDataset({ source: "contoso", scenario: "comfortable", plan: "baseline" });
  const constrained = await loadSourceDataset({ source: "contoso", scenario: "constrained", plan: "baseline" });
  for (const id of ["capacity", "tow-windows", "accommodation"]) {
    assert.throws(() => createOperationsDataset({ ...constrained, overlays: {
      ...constrained.overlays!, profiles: { ...constrained.overlays!.profiles, [id]: comfortable.overlays!.profiles[id] },
    } }));
  }
  for (const id of ["capacity-atlas", "plan-comparison"]) {
    assert.throws(() => createOperationsDataset({ ...constrained, overlays: {
      ...constrained.overlays!, companions: { ...constrained.overlays!.companions, [id]: comfortable.overlays!.companions![id] },
    } }));
  }
});
