import { useEffect, useId, useState } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Select,
} from "@fluentui/react-components";
import { SettingsRegular } from "@fluentui/react-icons";
import { useDemo } from "./DemoContext";
import { DEFAULT_DEMO_PREFERENCES, isPlanVariant, isScenarioId } from "./preferences";

export function DemoSettingsButton({ onClick }: { onClick: () => void }) {
  const { loading } = useDemo();
  return (
    <Button id="demo-settings-trigger" data-ops-keep-selection="" icon={<SettingsRegular />} appearance="subtle" disabled={loading} onClick={onClick}>
    </Button>
  );
}

export function DemoSettings({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const { preferences, apply, loading, error } = useDemo();
  const [draft, setDraft] = useState(preferences);
  useEffect(() => { if (open) setDraft(preferences); }, [open, preferences]);
  const sourceId = useId(), scenarioId = useId(), variantId = useId();
  const submit = async (value = draft) => {
    if (await apply(value)) setOpen(false);
  };
  return (
      <Dialog
        open={open}
        onOpenChange={(_, data) => { if (!loading) setOpen(data.open); }}
        surfaceMotion={{ onMotionFinish: () => {
          // Switching datasets replaces the trigger; target its current instance.
          if (!open) document.getElementById("demo-settings-trigger")?.focus({ preventScroll: true });
        } }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Demo settings</DialogTitle>
            <DialogContent>
              <p>Switch the whole workspace without restarting. Choices are remembered on this device and origin.</p>
              <Field label={{ children: "Data source", htmlFor: sourceId }}>
                <Select id={sourceId} value={draft.source} disabled={loading} onChange={(_, data) => {
                  if (data.value === "original" || data.value === "contoso") setDraft(current => ({ ...current, source: data.value === "contoso" ? "contoso" : "original" }));
                }}>
                  <option value="original">Existing demo</option>
                  <option value="contoso">Contoso scenarios</option>
                </Select>
              </Field>
              <Field label={{ children: "Scenario", htmlFor: scenarioId }}>
                <Select id={scenarioId} value={draft.scenario} disabled={loading || draft.source === "original"} onChange={(_, data) => {
                  const value = data.value;
                  if (isScenarioId(value)) setDraft(current => ({ ...current, scenario: value }));
                }}>
                  <option value="comfortable">Comfortable</option>
                  <option value="constrained">Constrained</option>
                </Select>
              </Field>
              <Field label={{ children: "Plan", htmlFor: variantId }}>
                <Select id={variantId} value={draft.variant} disabled={loading || draft.source === "original"} onChange={(_, data) => {
                  const value = data.value;
                  if (isPlanVariant(value)) setDraft(current => ({ ...current, variant: value }));
                }}>
                  <option value="baseline">Baseline</option>
                  <option value="tow-options">Tow options</option>
                </Select>
              </Field>
              <p>Prepared synthetic plans only. Switching resets selections, views, filters and alert acknowledgements. It does not run the solver.</p>
              {error && <p role="alert">{error}</p>}
            </DialogContent>
            <DialogActions>
              <Button disabled={loading} onClick={() => void submit(DEFAULT_DEMO_PREFERENCES)}>Reset to original demo</Button>
              <Button disabled={loading} onClick={() => setOpen(false)}>Cancel</Button>
              <Button appearance="primary" disabled={loading} onClick={() => void submit()}>{loading ? "Loading..." : "Apply"}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
  );
}

export function DemoStatus() {
  const { dataset, loading, error } = useDemo();
  return (
    <>
      <p className="ops-filter-status" role="status">
        {dataset.label} · Synthetic · UTC{loading ? " · Loading demo..." : ""}
      </p>
      {error && <p className="ops-filter-status" role="alert">{error}</p>}
    </>
  );
}
