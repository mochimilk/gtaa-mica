// Composes the independent panel modules as vertically stacked, collapsible
// Coral Panel.NavGroup sections (Arrivals, Departures, Alerts). The panel
// fills Coral's Panel.Left content area: open groups share the height and
// each scrolls on its own, so all group headers stay visible.
import { useState, type ReactNode } from "react";
import { Panel } from "@coral-ai/react";
import { Alerts } from "./Alerts";
import { ArrivalList } from "./ArrivalList";
import { DepartureList } from "./DepartureList";
import { useOperations } from "./OperationsContext";
import { OverflowScroll } from "./OverflowScroll";
import { ARRIVALS, DEPARTURES, OPS_ALERTS } from "./operationsData";
import "./operations.css";

type GroupKey = "arrivals" | "departures" | "alerts";

export function OperationsPanel() {
  // Default: all three expanded (not mutually exclusive); each can collapse independently.
  const [open, setOpen] = useState<Record<GroupKey, boolean>>({
    arrivals: true,
    departures: true,
    alerts: true,
  });
  const { acknowledged, matcher } = useOperations();
  // Counts follow the current view/filters ("x of y" while one is active).
  const openAlerts = OPS_ALERTS.filter((a) => !acknowledged.has(a.id));
  const openShown = openAlerts.filter(matcher.alert).length;
  const describe = (list: typeof ARRIVALS) => {
    const shown = list.filter(matcher.flight);
    const unassigned = shown.filter((f) => !f.standId).length;
    const count = matcher.active ? `${shown.length} of ${list.length}` : `${list.length}`;
    return `${count} flights · ${unassigned} unassigned`;
  };
  const alertsText =
    matcher.active && openShown !== openAlerts.length
      ? `${openShown} of ${openAlerts.length} open`
      : `${openAlerts.length} open`;

  // Each group sits in its own headless Panel.NavSection: with no label the
  // section has no header and is always open, and `border` gives the bottom
  // divider after each group. Collapsing stays on the NavGroup.
  const group = (key: GroupKey, label: string, description: string, content: ReactNode) => (
    <Panel.NavSection border className={open[key] ? "ops-section ops-section--open" : "ops-section"}>

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
        {group("alerts", "Alerts", alertsText, <Alerts />)}
      </div>
      {/* Selection details/actions now live in SelectionPopover, anchored to the selection. */}
    </div>
  );
}
