import { useState } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Tooltip, makeStyles,
} from "@fluentui/react-components";
import { CalendarLtrRegular } from "@fluentui/react-icons";
import { SourcePicker } from "./SourcePicker";
import { readSourceSelection, SCHEDULE_SOURCES } from "./registry";

const useStyles = makeStyles({
  surface: { width: "min(520px, calc(100vw - 32px))", maxWidth: "none", maxHeight: "calc(100dvh - 32px)" },
});

export function ScenarioToolbar() {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const selection = readSourceSelection(window.location.search);
  const source = SCHEDULE_SOURCES.find(item => item.id === selection.source)!;
  const scenario = source.scenarios.find(item => item.id === selection.scenario)!;
  const label = `${source.label}, ${scenario.label}, ${selection.plan === "baseline" ? "Baseline" : "Tow options"}`;
  return <>
    <Tooltip content={label} relationship="description">
      <Button data-ops-keep-selection="" appearance="subtle" icon={<CalendarLtrRegular />}
        aria-label={`Scenario options: ${label}`} onClick={() => setOpen(true)}>Scenarios</Button>
    </Tooltip>
    <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}>
      <DialogSurface className={styles.surface} data-scenario-dialog="">
        <DialogBody>
          <DialogTitle>Airport, scenario and plan</DialogTitle>
          <DialogContent>{open && <SourcePicker />}</DialogContent>
          <DialogActions><Button onClick={() => setOpen(false)}>Close</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  </>;
}
