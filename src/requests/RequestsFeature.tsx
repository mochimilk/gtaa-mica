import { useEffect, useState, type PropsWithChildren } from "react";
import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogTitle, Tab, TabList,
} from "@fluentui/react-components";
import { CalendarAddRegular } from "@fluentui/react-icons";
import { WindowDialogSurface } from "../components/window-layer/WindowDialogSurface";
import type { OperationsDataset } from "../operations/dataset";
import { chooseSessionAccommodation } from "../operations/accommodationSession";
import { useAccommodationSession } from "../operations/useAccommodationSession";
import { accommodationOptionLabel } from "../overlays/accommodation";
import { DecisionSummaryProvider, DecisionSummaryReview } from "../overlays/DecisionSummaryFeature";
import { AccommodationProvider, AccommodationReview, useAccommodationReviewState } from "./AccommodationFeature";
import { RequestContext, useRequests, type RequestDecision } from "./RequestContext";
import { availableRequests } from "./registry";
import "./requests.css";

type DatasetProps = { dataset: OperationsDataset; visible: boolean };
export function RequestsProvider({ dataset, visible, children }: PropsWithChildren<DatasetProps>) {
  const features = availableRequests(dataset);
  let content = <RequestsSession dataset={dataset} visible={visible}>{children}</RequestsSession>;
  if (features.analysis) content = <DecisionSummaryProvider dataset={dataset}>{content}</DecisionSummaryProvider>;
  if (features.accommodation) content = <AccommodationProvider dataset={dataset}>{content}</AccommodationProvider>;
  return content;
}

function RequestsSession({ dataset, visible, children }: PropsWithChildren<DatasetProps>) {
  const features = availableRequests(dataset), accommodation = useAccommodationReviewState();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(features.accommodation ? "request" : "analysis");
  const [decision, setDecision] = useState<RequestDecision | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) {
      setOpen(false);
      setDecision(null);
      setAcknowledged(false);
      setError(null);
    }
  }, [visible]);
  const selected = decision?.type === "accept" && accommodation && dataset.preparedPlan
    ? accommodation.evidence.variants[dataset.preparedPlan.variant].options.find(item => item.id === decision.optionId) : null;
  const assumption = decision?.type === "accept"
    ? accommodation?.waiting?.assumptions.find(item => item.id === decision.assumptionId) : null;
  const confirm = () => {
    try {
      if (!decision) throw new Error("No request decision selected.");
      chooseSessionAccommodation(decision.type === "restore" ? decision : { ...decision, confirmed: acknowledged });
      setDecision(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return <RequestContext.Provider value={{
    open: () => setOpen(true), decide: next => { setError(null); setAcknowledged(false); setDecision(next); },
  }}>
    {children}
    <Dialog open={visible && open} onOpenChange={(_, data) => setOpen(data.open)}>
      <WindowDialogSurface className="request-dialog" data-requests-dialog="" data-ops-keep-selection="">
        <DialogBody>
          <DialogTitle>Requests</DialogTitle>
          <DialogContent>
            {features.accommodation && features.analysis && <TabList selectedValue={tab} onTabSelect={(_, data) => {
              if (data.value !== "request" && data.value !== "analysis") throw new Error("Unknown request view.");
              setTab(data.value);
            }}>
              <Tab value="request">Late request</Tab><Tab value="analysis">Reference analysis</Tab>
            </TabList>}
            {tab === "request" && features.accommodation && <AccommodationReview dataset={dataset} />}
            {tab === "analysis" && features.analysis && <DecisionSummaryReview dataset={dataset} />}
          </DialogContent>
          <DialogActions><Button onClick={() => setOpen(false)}>Close</Button></DialogActions>
        </DialogBody>
      </WindowDialogSurface>
    </Dialog>
    <Dialog open={visible && decision !== null} onOpenChange={(_, data) => { if (!data.open) setDecision(null); }}>
      <WindowDialogSurface data-accommodation-confirmation="" data-ops-keep-selection="">
        <DialogBody>
          <DialogTitle>{decision?.type === "restore" ? "Undo accommodation?" : "Apply request option?"}</DialogTitle>
          <DialogContent>
            {decision?.type === "restore" ? <p>Remove the added service and all accommodation reassignments.
              Restore the exact original reference and its analysis controls.</p> : <>
              {selected && <p>{accommodationOptionLabel(dataset, selected)}</p>}
              <p>Waiting assumption: {assumption?.label}. Replaces any applied option; changes do not accumulate.</p>
              <Checkbox checked={acknowledged} data-accommodation-acknowledge=""
                onChange={(_, data) => setAcknowledged(data.checked === true)}
                label="I reviewed the turn assignments, timing and gaps. Apply this option to the session only." />
            </>}
            <p>This clears selections and pending agent work and ends active calls. No backend write or operational authorization.</p>
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDecision(null)}>Cancel</Button>
            <Button appearance="primary" data-accommodation-confirm=""
              disabled={decision?.type === "accept" && !acknowledged} onClick={confirm}>
              {decision?.type === "restore" ? "Undo accommodation" : "Confirm option"}
            </Button>
          </DialogActions>
        </DialogBody>
      </WindowDialogSurface>
    </Dialog>
  </RequestContext.Provider>;
}

export function RequestsToolbar() {
  const { reference, accepted } = useAccommodationSession();
  const features = availableRequests(reference), actions = useRequests();
  if (!features.accommodation && !features.analysis) return null;
  return <>
    <Button data-requests-toolbar="" data-ops-keep-selection="" appearance={accepted ? "primary" : "subtle"}
      icon={<CalendarAddRegular />} onClick={actions.open}>
      {features.accommodation ? accepted ? "Requests (Applied)" : "Requests (1)" : "Reference analysis"}
    </Button>
    {accepted && <Button data-ops-keep-selection="" onClick={() => actions.decide({ type: "restore" })}>
      Undo accommodation
    </Button>}
  </>;
}
