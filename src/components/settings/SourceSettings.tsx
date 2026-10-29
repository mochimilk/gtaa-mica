import { useId, useState } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Select, makeStyles, tokens,
} from "@fluentui/react-components";
import { ACTIVE_DATASET } from "../../operations/activeDataset";
import { readSourceSelection, SCHEDULE_SOURCES, sourceSelectionUrl, validateSourceSelection } from "../../data-sources/registry";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
});

export function SourceSettings() {
  const styles = useStyles();
  const sourceId = useId();
  const planId = useId();
  const current = readSourceSelection(window.location.search);
  const [selection, setSelection] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const source = SCHEDULE_SOURCES.find(item => item.id === selection.source)!;
  const changed = selection.source !== current.source || selection.plan !== current.plan;
  return (
    <section className={styles.root} aria-label="Schedule source">
      <h2>Schedule source</h2>
      <p>Current: {ACTIVE_DATASET.label}</p>
      <p>The original fixture supports demo stand edits. Airport schedules are read-only synthetic solver plans, not operational certification.</p>
      <Field label="Airport or fixture">
        <Select id={sourceId} value={selection.source} onChange={(_, data) => {
          setSelection(validateSourceSelection(data.value, "baseline"));
        }}>
          {SCHEDULE_SOURCES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </Select>
      </Field>
      <Field label="Plan variant">
        <Select id={planId} value={selection.plan} onChange={(_, data) => {
          setSelection(validateSourceSelection(selection.source, data.value));
        }}>
          {source.plans.map(plan => <option key={plan} value={plan}>{plan === "baseline" ? "Baseline" : "Tow options"}</option>)}
        </Select>
      </Field>
      <Button appearance="primary" disabled={!changed} onClick={() => setConfirming(true)}>Load schedule</Button>
      <Dialog open={confirming} onOpenChange={(_, data) => setConfirming(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Reload with a different schedule?</DialogTitle>
            <DialogContent>
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
    </section>
  );
}
