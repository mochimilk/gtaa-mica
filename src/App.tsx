import {
  CoralShellColumn,
  CoralShellRow,
  Navbar,
  Content,
  Panel,
} from "@coral-ai/react";
import { Button, makeStyles } from "@fluentui/react-components";
import { useMemo, useState } from "react";
import { StandTimelineDemo } from "./stand-timeline-demo/StandTimelineDemo";
import { OperationsPanel } from "./operations/OperationsPanel";
import { OperationsProvider, useOperations } from "./operations/OperationsContext";
import { SelectionPopover } from "./operations/SelectionPopover";
import { ViewsFiltersToolbar } from "./operations/ViewsFiltersToolbar";
import { FilterStatus } from "./operations/FilterStatus";
import { TreeDeciduous } from "@coral-ai/bundleicons";
import { DemoProvider, useDemo } from "./demo/DemoContext";
import { DemoSettings, DemoSettingsButton, DemoStatus } from "./demo/DemoSettings";
import { DEFAULT_BUFFER_PROFILE, evaluateBufferPlans } from "./demo/buffer-evaluation";
import { BufferOverlay, PlanReview, type ReviewMetric } from "./demo/PlanReview";
import { DEFAULT_GATE_WAIT_PROFILE, evaluateGateWaitPlans } from "./demo/gate-wait-evaluation";
import { evaluateCapacityQuery } from "./demo/capacity-evaluation";
import { CapacityOverlay, CapacityReview, capacityColor, initialCapacityReview } from "./demo/CapacityReview";
import { PlanDecisionReview } from "./demo/PlanDecisionReview";
import { evaluateTowWindows, towWindowSegments } from "./demo/tow-windows-evaluation";
import { TowWindowOverlay, TowWindowReview } from "./demo/TowWindowReview";

/*
 * GTAA-only Navbar height. Coral's Navbar root is 44px (Griffel); passing a
 * Griffel class through the supported `styles.root` slot is merged after it,
 * so these declarations win. flexShrink 0 keeps it from compressing in the
 * shell column.
 */
const useNavbarStyles = makeStyles({
  root: {
    // height: "64px",
    flexShrink: 0,
  },
});

/** Chart wired to the shared operations selection, views and filters. */
function ConnectedTimeline({ openDemoSettings }: { openDemoSettings: () => void }) {
  const { acceptedOptionId } = useDemo();
  const { selection, applyChartIntent, matcher, dataset } = useOperations();
  const [threshold, setThreshold] = useState(dataset.prepared?.reviewProfiles?.buffers.threshold_minutes ?? DEFAULT_BUFFER_PROFILE.threshold_minutes);
  const [showBuffers, setShowBuffers] = useState(false);
  const [bufferReviewOpen, setBufferReviewOpen] = useState(false);
  const [selectedBufferId, setSelectedBufferId] = useState("");
  const [reviewMetric, setReviewMetric] = useState<ReviewMetric>("buffers");
  const [showWaiting, setShowWaiting] = useState(false);
  const [assumptionId, setAssumptionId] = useState(dataset.prepared?.reviewProfiles?.waiting.default_assumption_id ?? DEFAULT_GATE_WAIT_PROFILE.default_assumption_id);
  const [showTowWindows, setShowTowWindows] = useState(false), [towReviewOpen, setTowReviewOpen] = useState(false);
  const [selectedTowVisit, setSelectedTowVisit] = useState("");
  const towEvidence = dataset.prepared?.towWindows;
  const towAssessments = useMemo(() => dataset.prepared && towEvidence
    ? evaluateTowWindows(dataset.prepared.snapshot, towEvidence, dataset.prepared.variant) : [], [dataset.prepared, towEvidence]);
  const towSegments = useMemo(() => towWindowSegments(towAssessments, dataset.domain), [towAssessments, dataset.domain]);
  const capacity = dataset.prepared?.capacity;
  const [capacityState, setCapacityState] = useState(() => initialCapacityReview(dataset.prepared?.snapshot, capacity));
  const capacityQuery = useMemo(() => capacity
    ? evaluateCapacityQuery(capacity, capacityState.probeId, capacityState.duration, capacityState.start, capacityState.end)
    : null, [capacity, capacityState.probeId, capacityState.duration, capacityState.start, capacityState.end]);
  const opportunities = dataset.prepared && capacityQuery?.variants?.[dataset.prepared.variant].opportunities;
  const capacityLayers = useMemo(() => {
    const prepared = dataset.prepared;
    if (!capacity || !prepared) return [];
    return capacity.profile.probes.flatMap((probe, index) => {
      if (!capacityState.allProbes && probe.id !== capacityState.probeId) return [];
      const duration = capacityState.allProbes ? probe.default_duration_minutes : Number(capacityState.duration);
      const result = evaluateCapacityQuery(capacity, probe.id, String(duration), capacityState.start, capacityState.end);
      return [{ probe, duration, color: capacityColor(index), opportunities: result.variants?.[prepared.variant].opportunities ?? [] }];
    });
  }, [capacity, dataset.prepared, capacityState.allProbes, capacityState.probeId, capacityState.duration, capacityState.start, capacityState.end]);
  const reviewProfiles = dataset.prepared?.reviewProfiles;
  const evaluation = useMemo(() => dataset.prepared && reviewProfiles
    ? evaluateBufferPlans(dataset.prepared.snapshot, { ...reviewProfiles.buffers, threshold_minutes: threshold })
    : null, [dataset, reviewProfiles, threshold]);
  const gateEvaluation = useMemo(() => dataset.prepared && reviewProfiles
    ? evaluateGateWaitPlans(dataset.prepared.snapshot, reviewProfiles.waiting, assumptionId)
    : null, [dataset, reviewProfiles, assumptionId]);
  return (
    <>
      {/* Details show in SelectionPopover, so the demo's own detail strip is hidden here.
          Non-matching bars are dimmed (still occupied/selectable), never removed. */}
      <StandTimelineDemo
        data={dataset.timeline}
        domain={dataset.domain}
        date={dataset.date}
        subtitle={dataset.subtitle}
        selectedIds={selection.occupancyIds}
        onIntent={applyChartIntent}
        showSelectionDetail={false}
        isMatch={matcher.active ? matcher.occupancy : undefined}
        selectionActive={selection.occupancyIds.length > 0 || !!selection.flightId}
        toolbar={<>
          <ViewsFiltersToolbar />
          <PlanDecisionReview />
          {dataset.prepared && !reviewProfiles && <>
            <Button disabled title="Airport-specific review profiles are not prepared.">Compare plans</Button>
            <Button disabled title="Airport-specific buffer profile is not prepared.">Buffers</Button>
            <Button disabled title="Airport-specific waiting assumptions are not prepared.">Gate waiting</Button>
          </>}
          {dataset.prepared && !capacity && <Button disabled title="Airport-specific capacity and atlas evidence is not prepared.">Capacity</Button>}
          {dataset.prepared && !dataset.prepared.accommodation && <Button disabled title="Airport-specific accommodation evidence is not prepared.">Late request</Button>}
          {dataset.prepared && !towEvidence && <Button disabled title="Airport-specific tow-window evidence is not prepared.">Tow windows</Button>}
          {towEvidence && <TowWindowReview evidence={towEvidence} assessments={towAssessments}
            selectedId={selectedTowVisit} setSelectedId={setSelectedTowVisit} open={towReviewOpen} setOpen={setTowReviewOpen}
            show={showTowWindows} setShow={setShowTowWindows} />}
          {evaluation && gateEvaluation && dataset.prepared && <PlanReview
            snapshot={dataset.prepared.snapshot} evaluation={evaluation} variant={dataset.prepared.variant}
            open={bufferReviewOpen} setOpen={setBufferReviewOpen} showOverlay={showBuffers} setShowOverlay={setShowBuffers}
            setThreshold={setThreshold} selectedId={selectedBufferId} setSelectedId={setSelectedBufferId}
            gateEvaluation={gateEvaluation} metric={reviewMetric} setMetric={setReviewMetric}
            showWaiting={showWaiting} setShowWaiting={setShowWaiting} setAssumption={setAssumptionId}
          />}
          {capacity && capacityQuery && dataset.prepared && <CapacityReview
            snapshot={dataset.prepared.snapshot} capacity={capacity} variant={dataset.prepared.variant}
            state={capacityState} setState={setCapacityState} query={capacityQuery}
            atlas={dataset.prepared.atlas} layers={capacityLayers}
          />}
          <DemoSettingsButton onClick={openDemoSettings} />
        </>}
        notice={<><DemoStatus /><FilterStatus />{dataset.prepared && !reviewProfiles && <p className="ops-filter-status" role="note">
          Schedule-only demo. Airport-specific analysis profiles and evidence are not prepared; disabled reviews do not reuse Contoso assumptions.
        </p>}{acceptedOptionId && <p className="ops-filter-status" role="status">
          Session-only accommodation accepted. Use Compare plans to review the retained reference; Late request to restore it.
          Reference capacity/atlas and chart-metric reviews are hidden, not reused against changed assignments.
        </p>}{showBuffers && evaluation && dataset.prepared && <p className="ops-filter-status" role="status">
          Scheduled buffers v{evaluation.metric.version}: {evaluation.variants[dataset.prepared.variant].buffers.availability === "invalid"
            ? "invalid due to overlapping occupancy"
            : `${evaluation.variants[dataset.prepared.variant].buffers.summary.tight_count} handovers below ${threshold} min`}.
          {" "}Whole-plan review; not a solver objective. Dashed amber intervals are buffers, not occupancy.
        </p>}{showWaiting && gateEvaluation && dataset.prepared && <p className="ops-filter-status" role="status">
          Predicted gate waiting (synthetic, {gateEvaluation.assumption.label}): {gateEvaluation.variants[dataset.prepared.variant].waiting.summary.total_wait_minutes === null
            ? gateEvaluation.variants[dataset.prepared.variant].waiting.availability
            : `${Number(gateEvaluation.variants[dataset.prepared.variant].waiting.summary.total_wait_minutes?.toFixed(2))} min`}.
          {" "}Blue dots mark positive arrival estimates, not added occupancy. Whole-plan review; not a solver objective.
        </p>}{showTowWindows && towEvidence && <p className="ops-filter-status" role="status">
          Tow windows: gold hatched sections inside lozenges show destination-checked one-way tow starts.
          {" "}{towSegments.length} visible ranges; other assignments and flight times stay fixed. Routes and crews are not certified.
        </p>}{capacityState.show && capacity && <p className="ops-filter-status" role="status">
          Single-turn capacity v{capacity.metric_version}: {capacityQuery?.error ?? (capacityState.allProbes
            ? `${capacityLayers.reduce((count, layer) => count + layer.opportunities.length, 0)} alternative arrival-start ranges across ${capacityLayers.length} probes`
            : `${opportunities?.length ?? 0} feasible arrival-start ranges`)}.
          {" "}{capacityState.allProbes ? `${capacityLayers.length} colored probes shown. ` : ""}
          Colored borders are alternative start times, not occupancy or additive slots.
          {" "}{capacityState.mode !== "current" && `Intensity: synthetic ${capacityState.mode === "end_of_day" ? "modeled end-of-day" : capacityState.mode}; not observed history or an accommodation probability. `}
          Whole-plan rules; filters do not change this query.
        </p>}</>}
        plotLayers={<>{(showBuffers || showWaiting) && evaluation && gateEvaluation && dataset.prepared ? <BufferOverlay
          snapshot={dataset.prepared.snapshot} result={evaluation.variants[dataset.prepared.variant].buffers}
          waiting={gateEvaluation.variants[dataset.prepared.variant].waiting}
          showBuffers={showBuffers} showWaiting={showWaiting}
          isMatch={matcher.active ? matcher.occupancy : undefined}
          onInspect={(id, metric) => { setSelectedBufferId(id); setReviewMetric(metric); setBufferReviewOpen(true); }}
        /> : undefined}
          {capacityState.show && opportunities && dataset.prepared && <CapacityOverlay
            layers={capacityLayers} snapshot={dataset.prepared.snapshot}
            atlas={dataset.prepared.atlas} variant={dataset.prepared.variant} mode={capacityState.mode}
            onInspect={(id, probe, start) => setCapacityState({ ...capacityState, probeId: probe.id,
              duration: capacityState.allProbes ? String(probe.default_duration_minutes) : capacityState.duration,
              selectedId: id, selectedStart: start, open: true })}
          />}
          {showTowWindows && towEvidence && <TowWindowOverlay segments={towSegments}
            isMatch={matcher.active ? matcher.occupancy : undefined} onInspect={id => { setSelectedTowVisit(id); setTowReviewOpen(true); }} />}
        </>}
      />
      <SelectionPopover />
    </>
  );
}

export default function App() {
  return <DemoProvider><DemoWorkspace /></DemoProvider>;
}

function DemoWorkspace() {
  const navbarStyles = useNavbarStyles();
  const { dataset } = useDemo();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
    <OperationsProvider key={dataset.id} dataset={dataset}>
      <CoralShellColumn>
        <Navbar
          logo={<img src="/toronto_pearson.svg" alt="Toronto Pearson" />}
          styles={{ root: navbarStyles.root }}
        />

        <CoralShellRow>
          <Panel.Left panelWidth={320}>

            <OperationsPanel />
          </Panel.Left>
          <Content>
            {/*
              Bounded flex host: the timeline fills this height and scrolls its
              own rows between pinned rulers. overflowY stays as a fallback for
              viewports shorter than the timeline's minimum.
            */}
            <main
              style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                flex: "1 1 auto",
                height: "100%",
                minHeight: 0,
                overflowY: "auto",
              }}
            >
              <ConnectedTimeline openDemoSettings={() => setSettingsOpen(true)} />
            </main>
          </Content>
                         <Panel.Right icon={<TreeDeciduous/>}></Panel.Right>
          <Panel.Right></Panel.Right>
     
        </CoralShellRow>
      </CoralShellColumn>
    </OperationsProvider>
    <DemoSettings open={settingsOpen} setOpen={setSettingsOpen} />
    </>
  );
}
