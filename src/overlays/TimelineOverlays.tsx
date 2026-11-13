import { createContext, useContext, useEffect, useState, type ComponentType, type PropsWithChildren } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogTitle, Tooltip,
} from "@fluentui/react-components";
import { LayerRegular } from "@fluentui/react-icons";
import { WindowDialogSurface } from "../components/window-layer/WindowDialogSurface";
import { Menu, MenuDivider, MenuItem, MenuItemCheckbox, MenuList, MenuPopover, MenuTrigger } from "../components/menu";
import type { OperationsDataset } from "../operations/dataset";
import { useAccommodationSession } from "../operations/useAccommodationSession";
import {
  availableOverlays, changeOverlaySelection, EMPTY_OVERLAY_SELECTION,
  type OverlayId, type OverlayRegistration, type OverlaySelection,
} from "./registry";
import { BufferLayer, BufferProvider, BufferReview, WaitingLayer, WaitingProvider, WaitingReview } from "./StandOverlayFeatures";
import { CapacityLayer, CapacityProvider, CapacityReview } from "./CapacityFeature";
import { TowWindowLayer, TowWindowProvider, TowWindowReview } from "./TowWindowFeature";
import "./overlays.css";

type FeatureProps = { dataset: OperationsDataset; isMatch?: (stayId: string) => boolean };
export interface OverlayPresentation {
  Provider?: ComponentType<PropsWithChildren<{ dataset: OperationsDataset }>>;
  Underlay?: ComponentType<FeatureProps>;
  Overlay?: ComponentType<FeatureProps>;
  Review: ComponentType<{ dataset: OperationsDataset }>;
}

// Future overlays and review-only analyses register here, not in App.
const PRESENTATIONS = {
  buffers: { Provider: BufferProvider, Underlay: BufferLayer, Review: BufferReview },
  "gate-wait": { Provider: WaitingProvider, Underlay: WaitingLayer, Review: WaitingReview },
  capacity: { Provider: CapacityProvider, Underlay: CapacityLayer, Review: CapacityReview },
  "tow-windows": { Provider: TowWindowProvider, Overlay: TowWindowLayer, Review: TowWindowReview },
} satisfies Record<OverlayId, OverlayPresentation>;
const presentations = new Map<string, OverlayPresentation>(Object.entries(PRESENTATIONS));

function presentation(id: string): OverlayPresentation {
  const result = presentations.get(id);
  if (!result) throw new Error(`Missing overlay presentation: ${id}`);
  return result;
}

interface OverlayContextValue {
  dataset: OperationsDataset;
  available: readonly OverlayRegistration[];
  selection: OverlaySelection;
  change: (action: Parameters<typeof changeOverlaySelection>[2]) => void;
}
const OverlayContext = createContext<OverlayContextValue | null>(null);

function useOverlays() {
  const value = useContext(OverlayContext);
  if (!value) throw new Error("Overlay controls and layers require TimelineOverlayProvider.");
  return value;
}

export function TimelineOverlayProvider({ dataset, children }: PropsWithChildren<{ dataset: OperationsDataset }>) {
  // Source/plan/profile changes remount all feature-local options and selection together.
  return <OverlaySession key={`${dataset.id}:${JSON.stringify(dataset.overlays ?? null)}`} dataset={dataset}>{children}</OverlaySession>;
}

function OverlaySession({ dataset, children }: PropsWithChildren<{ dataset: OperationsDataset }>) {
  const available = availableOverlays(dataset);
  const [selection, setSelection] = useState(EMPTY_OVERLAY_SELECTION);
  const content = available.reduceRight((child, feature) => {
    const Provider = presentation(feature.id).Provider;
    return Provider ? <Provider key={feature.id} dataset={dataset}>{child}</Provider> : child;
  }, children);
  return (
    <OverlayContext.Provider value={{
      dataset, available, selection,
      change: action => setSelection(state => changeOverlaySelection(state, available, action)),
    }}>{content}</OverlayContext.Provider>
  );
}

export function OverlayToolbar() {
  const { available, selection, change } = useOverlays();
  const { accepted } = useAccommodationSession();
  if (!available.length) return null;
  const overlays = available.filter(feature => !feature.reviewOnly);
  const name = selection.enabled.length ? `Overlays: ${selection.enabled.length} enabled` : "Overlays: none enabled";
  return (
    <Menu checkedValues={{ overlays: [...selection.enabled] }}>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={name} relationship="description">
          <Button data-ops-keep-selection="" data-overlay-toolbar="" aria-label={name}
            appearance={selection.enabled.length ? "primary" : "subtle"} icon={<LayerRegular />}>
            {selection.enabled.length ? `Overlays (${selection.enabled.length})` : "Overlays"}
          </Button>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover data-ops-keep-selection="">
        <MenuList>
          {accepted && <MenuItem disabled>Capacity / Atlas / tow need fresh evidence</MenuItem>}
          {overlays.map(feature => (
            <MenuItemCheckbox key={feature.id} name="overlays" value={feature.id}
              title={feature.description} persistOnClick onClick={() => change({ type: "toggle", id: feature.id })}>
              {feature.label}
            </MenuItemCheckbox>
          ))}
          {!!overlays.length && <MenuDivider />}
          {available.map(feature => (
            <MenuItem key={feature.id} onClick={() => change({ type: "inspect", id: feature.id })}>Inspect {feature.label}</MenuItem>
          ))}
          <MenuDivider />
          <MenuItem disabled={!selection.enabled.length} onClick={() => change({ type: "reset" })}>Hide all overlays</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function OverlayLayers({ position, isMatch }: {
  position: "underlay" | "overlay"; isMatch?: (stayId: string) => boolean;
}) {
  const { dataset, available, selection } = useOverlays();
  return <>{available.filter(feature => selection.enabled.includes(feature.id)).map(feature => {
    const view = presentation(feature.id);
    const Layer = position === "underlay" ? view.Underlay : view.Overlay;
    return Layer ? <Layer key={feature.id} dataset={dataset} isMatch={isMatch} /> : null;
  })}</>;
}

export function OverlayReviews({ visible = true }: { visible?: boolean }) {
  const { dataset, available, selection, change } = useOverlays();
  const { accepted } = useAccommodationSession();
  useEffect(() => {
    if (!visible && selection.review) change({ type: "close" });
  }, [visible, selection.review, change]);
  const feature = available.find(item => item.id === selection.review);
  if (!visible || !feature) return null;
  const Review = presentation(feature.id).Review;
  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) change({ type: "close" }); }}>
      <WindowDialogSurface className="timeline-overlay-dialog">
        <DialogBody>
          <DialogTitle>{feature.label}</DialogTitle>
          <DialogContent>
            <p>{dataset.label}. {feature.description}</p>
            {accepted && <p role="status">Recalculated for the amended board. Synthetic waiting is illustrative, not actual delay.</p>}
            <Review dataset={dataset} />
          </DialogContent>
          <DialogActions><Button onClick={() => change({ type: "close" })}>Close</Button></DialogActions>
        </DialogBody>
      </WindowDialogSurface>
    </Dialog>
  );
}
