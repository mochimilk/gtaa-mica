import {
  CoralShellColumn,
  CoralShellRow,
  Navbar,
  Content,
  Panel,
} from "@coral-ai/react";
import { makeStyles } from "@fluentui/react-components";
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
  const { selection, applyChartIntent, matcher, dataset } = useOperations();
  const [threshold, setThreshold] = useState(DEFAULT_BUFFER_PROFILE.threshold_minutes);
  const [showBuffers, setShowBuffers] = useState(false);
  const [bufferReviewOpen, setBufferReviewOpen] = useState(false);
  const [selectedBufferId, setSelectedBufferId] = useState("");
  const [reviewMetric, setReviewMetric] = useState<ReviewMetric>("buffers");
  const [showWaiting, setShowWaiting] = useState(false);
  const [assumptionId, setAssumptionId] = useState(DEFAULT_GATE_WAIT_PROFILE.default_assumption_id);
  const evaluation = useMemo(() => dataset.prepared
    ? evaluateBufferPlans(dataset.prepared.snapshot, { ...DEFAULT_BUFFER_PROFILE, threshold_minutes: threshold })
    : null, [dataset, threshold]);
  const gateEvaluation = useMemo(() => dataset.prepared
    ? evaluateGateWaitPlans(dataset.prepared.snapshot, DEFAULT_GATE_WAIT_PROFILE, assumptionId)
    : null, [dataset, assumptionId]);
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
          {evaluation && gateEvaluation && dataset.prepared && <PlanReview
            snapshot={dataset.prepared.snapshot} evaluation={evaluation} variant={dataset.prepared.variant}
            open={bufferReviewOpen} setOpen={setBufferReviewOpen} showOverlay={showBuffers} setShowOverlay={setShowBuffers}
            setThreshold={setThreshold} selectedId={selectedBufferId} setSelectedId={setSelectedBufferId}
            gateEvaluation={gateEvaluation} metric={reviewMetric} setMetric={setReviewMetric}
            showWaiting={showWaiting} setShowWaiting={setShowWaiting} setAssumption={setAssumptionId}
          />}
          <DemoSettingsButton onClick={openDemoSettings} />
        </>}
        notice={<><DemoStatus /><FilterStatus />{showBuffers && evaluation && dataset.prepared && <p className="ops-filter-status" role="status">
          Scheduled buffers v{evaluation.metric.version}: {evaluation.variants[dataset.prepared.variant].buffers.availability === "invalid"
            ? "invalid due to overlapping occupancy"
            : `${evaluation.variants[dataset.prepared.variant].buffers.summary.tight_count} handovers below ${threshold} min`}.
          {" "}Whole-plan review; not a solver objective. Dashed amber intervals are buffers, not occupancy.
        </p>}{showWaiting && gateEvaluation && dataset.prepared && <p className="ops-filter-status" role="status">
          Predicted gate waiting (synthetic, {gateEvaluation.assumption.label}): {gateEvaluation.variants[dataset.prepared.variant].waiting.summary.total_wait_minutes === null
            ? gateEvaluation.variants[dataset.prepared.variant].waiting.availability
            : `${Number(gateEvaluation.variants[dataset.prepared.variant].waiting.summary.total_wait_minutes?.toFixed(2))} min`}.
          {" "}Blue dots mark positive arrival estimates, not added occupancy. Whole-plan review; not a solver objective.
        </p>}</>}
        plotLayers={(showBuffers || showWaiting) && evaluation && gateEvaluation && dataset.prepared ? <BufferOverlay
          snapshot={dataset.prepared.snapshot} result={evaluation.variants[dataset.prepared.variant].buffers}
          waiting={gateEvaluation.variants[dataset.prepared.variant].waiting}
          showBuffers={showBuffers} showWaiting={showWaiting}
          isMatch={matcher.active ? matcher.occupancy : undefined}
          onInspect={(id, metric) => { setSelectedBufferId(id); setReviewMetric(metric); setBufferReviewOpen(true); }}
        /> : undefined}
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
