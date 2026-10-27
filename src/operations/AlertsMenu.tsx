// Notifications (bell) toggle for the app bar, right of Ask Skye's Connect.
// It opens the synthetic alerts in a window floating above Ask Skye's bar
// (AskFloatingWindow), in the chat's glass; it and the chat close each other.
// The bell has a red dot while any open alert matches the filters, as the
// list inside does. data-ops-menu="alerts" marks it for Skye's cursor
// (agentGestures.ts).
import { useId, useSyncExternalStore } from "react";
import { ToggleButton, Tooltip } from "@fluentui/react-components";
import { AlertFilled, AlertRegular, bundleIcon, createFluentIcon } from "@fluentui/react-icons";
import { AskFloatingWindow, useAskPanel } from "../components/ask-skye";
import { useAnyAskPanelOpen } from "../components/ask-skye/askPanels";
import { skyeAlerts, hideSkyeAlerts, subscribeSkyeAlerts } from "./skyeAlerts";
import { Alerts } from "./Alerts";
import { useOperations } from "./OperationsContext";
import { currentAlerts } from "./boardAlerts";
import { KEEP_SELECTION_ATTR } from "./ViewsFiltersToolbar";
import "./operations.css";

/*
 * Fluent's Alert bell with a bigger dot than AlertBadge's (r 3.5 at 15.75,4),
 * cut 1 unit clear of it. The dot is each icon's last path, so it can be
 * coloured on its own (.ops-alerts-bell in operations.css). Bundled, the
 * toggle swaps to the filled bell on hover and while open, as the chat's does.
 */
const ALERT_DOT = "M12.25 4a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0Z";
const AlertDotRegular = createFluentIcon("AlertDotRegular", "1em", [
  "M10 2c.56-.01 1.11.06 1.62.2-.13.3-.23.62-.29.95-.42-.11-.87-.16-1.33-.15-2.55-.06-4.71 1.85-4.98 4.38l-.02.22v3.9l-.04.2-.96 2.3h12l-.96-2.3-.04-.2v-3.06c.24.04.49.06.75.06.08 0 .17 0 .25-.01v2.91l.92 2.22c.03.05.05.11.06.17l.01.08.01.13c0 .46-.31.86-.75.97l-.11.02-.14.01h-3.5v.17c0 1.38-1.12 2.5-2.5 2.5s-2.5-1.12-2.5-2.5v-.17h-3.5c-.09 0-.18-.01-.26-.03l-.13-.04c-.41-.18-.66-.61-.6-1.05l.02-.13.05-.13.92-2.22v-3.83c.18-3.17 2.83-5.63 6-5.57ZM11.5 15h-3v.15c.07.71.64 1.28 1.36 1.34l.14.01c.78 0 1.42-.6 1.5-1.36Z",
  ALERT_DOT,
]);
const AlertDotFilled = createFluentIcon("AlertDotFilled", "1em", [
  "M12.45 16c-.24 1.17-1.26 2-2.45 2s-2.21-.84-2.45-2ZM10 2c.56-.01 1.11.06 1.62.2-.24.55-.37 1.16-.37 1.8 0 2.49 2.01 4.5 4.5 4.5.08 0 .17 0 .25-.01v2.91l.95 2.6.03.08.01.09v.08c0 .32-.19.6-.51.71l-.12.03-.11.01h-12.5c-.2 0-.39-.08-.53-.23-.14-.14-.22-.33-.21-.53v-.12l.04-.12.95-2.6v-3.83c.18-3.17 2.83-5.63 6-5.57Z",
  ALERT_DOT,
]);
const AlertDotIcon = bundleIcon(AlertDotFilled, AlertDotRegular);
const AlertIcon = bundleIcon(AlertFilled, AlertRegular);

export function AlertsMenu() {
  const { acknowledged, matcher } = useOperations();
  const [open, setOpen] = useAskPanel("alerts");
  // Skye's compact alerts, while she talks about them: only when the user has
  // none of Ask Skye's windows open, and the user opening theirs takes over.
  const skye = useSyncExternalStore(subscribeSkyeAlerts, skyeAlerts);
  const anyPanel = useAnyAskPanelOpen();
  const compact = !open && !anyPanel && skye !== null;
  const windowId = useId();
  // Counts follow the filters ("x of y" while one hides some).
  const openAlerts = currentAlerts().filter((a) => !acknowledged.has(a.id));
  const shown = openAlerts.filter(matcher.alert);
  const count =
    matcher.active && shown.length !== openAlerts.length
      ? `${shown.length} of ${openAlerts.length} open`
      : `${openAlerts.length} open`;

  return (
    <>
      <Tooltip content={`Alerts: ${count}`} relationship="label">
        <ToggleButton
          {...KEEP_SELECTION_ATTR}
          data-ops-menu="alerts"
          appearance="subtle"
          checked={open}
          icon={shown.length > 0 ? <AlertDotIcon className="ops-alerts-bell" /> : <AlertIcon />}
          aria-controls={open ? windowId : undefined}
          onClick={() => setOpen(!open)}
        />
      </Tooltip>
      <AskFloatingWindow
        id={windowId}
        title="Alerts"
        open={open || compact}
        compact={compact}
        // Closing Skye's compact alerts puts them away until she next talks about them.
        onOpenChange={(next) => (compact && !next ? hideSkyeAlerts() : setOpen(next))}
      >
        {/* Selecting a flight closes the alerts, so its details can open by its bar or row. */}
        <Alerts
          onSelect={() => (compact ? hideSkyeAlerts() : setOpen(false))}
          compact={compact}
          mentioned={compact ? (skye?.mentioned ?? null) : null}
        />
      </AskFloatingWindow>
    </>
  );
}
