// Composes the independent panel modules as vertically stacked, collapsible
// Coral Panel.NavGroup sections (Arrivals, Departures). The panel fills
// Coral's Panel.Left content area: open groups share the height and each
// scrolls on its own, so all group headers stay visible. Alerts live in the
// chart header's Alerts menu (AlertsMenu.tsx).
import { useState, type ReactNode } from "react";
import { Panel } from "@coral-ai/react";
import { ArrivalList } from "./ArrivalList";
import { DepartureList } from "./DepartureList";
import { useOperations } from "./OperationsContext";
import { OverflowScroll } from "./OverflowScroll";
import { ARRIVALS, DEPARTURES } from "./operationsData";
import "./operations.css";

type GroupKey = "arrivals" | "departures";

export function OperationsPanel() {
  // Default: both expanded (not mutually exclusive); each can collapse independently.
  const [open, setOpen] = useState<Record<GroupKey, boolean>>({
    arrivals: true,
    departures: true,
  });
  const { matcher } = useOperations();
  // Counts follow the current view/filters ("x of y" while one is active).
  const describe = (list: typeof ARRIVALS) => {
    const shown = list.filter(matcher.flight);
    const unassigned = shown.filter((f) => !f.standId).length;
    const count = matcher.active ? `${shown.length} of ${list.length}` : `${list.length}`;
    return `${count} flights · ${unassigned} unassigned`;
  };

  // Each group sits in its own headless Panel.NavSection: with no label the
  // section has no header and is always open, and `border` gives the bottom
  // divider after each group. Collapsing stays on the NavGroup.
  const group = (key: GroupKey, label: string, description: string, content: ReactNode) => (
    // ops-section--<key> lets Skye's cursor find a group to expand (agentGestures.ts).
    <Panel.NavSection
      border
      className={`ops-section ops-section--${key}${open[key] ? " ops-section--open" : ""}`}
    >

      <Panel.NavGroup
        label={label}
        description={description}
        open={open[key]}
        onOpenChange={(_, d) => setOpen((cur) => ({ ...cur, [key]: d.open }))}
        className={open[key] ? "ops-group ops-group--open" : "ops-group"}
      >
        <OverflowScroll className="ops-group-scroll">{content}</OverflowScroll>
      </Panel.NavGroup>
    </Panel.NavSection>
  );

  return (
    <div className="ops-panel">

      <div className="ops-groups">
        {group("arrivals", "Arrivals", describe(ARRIVALS), <ArrivalList />)}
        {group("departures", "Departures", describe(DEPARTURES), <DepartureList />)}
      </div>
      {/* Selection details/actions now live in SelectionPopover, anchored to the selection. */}
    </div>
  );
}
