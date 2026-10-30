import { useState } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Select, makeStyles, tokens,
} from "@fluentui/react-components";
import { ACTIVE_DATASET } from "../operations/activeDataset";
import { readSourceSelection, SCHEDULE_SOURCES, sourceSelectionUrl, validateSourceSelection } from "./registry";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, minWidth: 0 },
});

export function SourcePicker() {
  const styles = useStyles();
  const current = readSourceSelection(window.location.search);
  const [selection, setSelection] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const source = SCHEDULE_SOURCES.find(item => item.id === selection.source)!;
  const scenario = source.scenarios.find(item => item.id === selection.scenario)!;
  const changed = selection.source !== current.source || selection.scenario !== current.scenario || selection.plan !== current.plan;
  return <section className={styles.root} aria-label="Schedule selection">
    <p>Current: {ACTIVE_DATASET.label}</p>
    <p>Scenarios are different demand sets. Baseline and Tow options are prepared plans for the selected scenario.
      Airport schedules are read-only and synthetic, not operational certification.</p>
    <Field label="Airport or fixture">
      <Select data-source-airport="" value={selection.source} onChange={(_, data) =>
        setSelection(validateSourceSelection(data.value, "baseline"))}>
        {SCHEDULE_SOURCES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </Select>
    </Field>
    <Field label="Scenario">
      <Select data-source-scenario="" value={selection.scenario} onChange={(_, data) =>
        setSelection(validateSourceSelection(selection.source, selection.plan, data.value))}>
        {source.scenarios.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </Select>
    </Field>
    <p data-source-description="">{scenario.description}</p>
    <Field label="Plan variant">
      <Select data-source-plan="" value={selection.plan} onChange={(_, data) =>
        setSelection(validateSourceSelection(selection.source, data.value, selection.scenario))}>
        {scenario.plans.map(plan => <option key={plan} value={plan}>{plan === "baseline" ? "Baseline" : "Tow options"}</option>)}
      </Select>
    </Field>
    <Button appearance="primary" disabled={!changed} onClick={() => setConfirming(true)}>Load schedule</Button>
    <Dialog open={confirming} onOpenChange={(_, data) => setConfirming(data.open)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Reload with a different schedule?</DialogTitle>
          <DialogContent>
            Load {source.label}, {scenario.label}, {selection.plan === "baseline" ? "Baseline" : "Tow options"}?
            Reloading clears local stand changes, selections, reviews and pending agent work, and ends any active call.
            Appearance settings and saved drawings are retained.
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button appearance="primary" onClick={() => window.location.assign(sourceSelectionUrl(new URL(window.location.href), selection))}>
              Reload and load
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  </section>;
}
