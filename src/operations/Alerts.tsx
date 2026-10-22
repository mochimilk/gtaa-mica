// Synthetic demo alerts. Acknowledging is local to this browser tab: nothing is
// saved or sent anywhere.
import { Button } from "@fluentui/react-components";
import { InfoRegular, WarningRegular } from "@fluentui/react-icons";
import { isFlightSelected, useOperations } from "./OperationsContext";
import type { OpsAlert } from "./operationsData";

export function Alerts() {
  const { acknowledged, matcher, dataset: { alerts: OPS_ALERTS } } = useOperations();
  // Alerts follow the filters (not the view; see opsFilters.ts).
  const shown = OPS_ALERTS.filter(matcher.alert);
  const open = shown.filter((a) => !acknowledged.has(a.id));
  const done = shown.filter((a) => acknowledged.has(a.id));

  return (
    <div className="ops-alerts">
      {open.length === 0 ? (
        <p className="ops-empty">
          {matcher.active && shown.length < OPS_ALERTS.length
            ? "No open alerts match the current filters."
            : "No open synthetic alerts."}
        </p>
      ) : (
        <ul className="ops-alert-list" aria-label="Open alerts">
          {open.map((a) => (
            <AlertItem key={a.id} alert={a} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <>
          <h3 className="ops-subhead">Acknowledged in this session</h3>
          <ul className="ops-alert-list" aria-label="Acknowledged alerts">
            {done.map((a) => (
              <AlertItem key={a.id} alert={a} acknowledged />
            ))}
          </ul>
        </>
      )}
      <p className="ops-footnote">
        Synthetic demo alerts derived from the sample data. Acknowledging is local only and is
        not saved.
      </p>
    </div>
  );
}

function AlertItem({ alert, acknowledged = false }: { alert: OpsAlert; acknowledged?: boolean }) {
  const { selection, selectFlight, setAcknowledged, dataset } = useOperations();
  const flight = dataset.flightsById.get(alert.flightId);
  const selected = !!flight && isFlightSelected(flight, selection);
  const Icon = alert.severity === "warning" ? WarningRegular : InfoRegular;

  return (
    <li
      className={[
        "ops-alert",
        selected ? "ops-alert--selected" : "",
        acknowledged ? "ops-alert--done" : "",
      ].join(" ")}
    >
      <Icon className={`ops-alert-icon ops-issue--${alert.severity}`} aria-hidden />
      <div className="ops-alert-body">
        <div className="ops-alert-title">
          <span className="ops-visually-hidden">
            {alert.severity === "warning" ? "Warning: " : "Notice: "}
          </span>
          {alert.title}
        </div>
        <div className="ops-muted">{alert.detail}</div>
        <div className="ops-alert-actions">
          {flight && (
            <Button
              size="small"
              appearance="subtle"
              aria-pressed={selected}
              // Fallback popover anchor for flights with no chart bar.
              data-ops-alert-flight={flight.id}
              onClick={() => selectFlight(flight, "alert")}
            >
              Select {flight.flight}
            </Button>
          )}
          <Button
            size="small"
            appearance="subtle"
            onClick={() => setAcknowledged(alert.id, !acknowledged)}
          >
            {acknowledged ? "Reopen (demo)" : "Acknowledge (demo)"}
          </Button>
        </div>
      </div>
    </li>
  );
}
