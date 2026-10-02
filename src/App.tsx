import {
  CoralShellColumn,
  CoralShellRow,
  Navbar,
  Content,
  Panel,
} from "@coral-ai/react";
import { makeStyles } from "@fluentui/react-components";
import { StandTimelineDemo } from "./stand-timeline-demo/StandTimelineDemo";
import { OperationsPanel } from "./operations/OperationsPanel";
import { OperationsProvider, useOperations } from "./operations/OperationsContext";
import { SelectionPopover } from "./operations/SelectionPopover";
import { TreeDeciduous } from "@coral-ai/bundleicons";

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

/** Chart wired to the shared operations selection. */
function ConnectedTimeline() {
  const { selection, applyChartIntent } = useOperations();
  return (
    <>
      {/* Details show in SelectionPopover, so the demo's own detail strip is hidden here. */}
      <StandTimelineDemo
        selectedIds={selection.occupancyIds}
        onIntent={applyChartIntent}
        showSelectionDetail={false}
      />
      <SelectionPopover />
    </>
  );
}

export default function App() {
  const navbarStyles = useNavbarStyles();
  return (
    <OperationsProvider>
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
              <ConnectedTimeline />
            </main>
          </Content>
                         <Panel.Right icon={<TreeDeciduous/>}></Panel.Right>
          <Panel.Right></Panel.Right>
     
        </CoralShellRow>
      </CoralShellColumn>
    </OperationsProvider>
  );
}
