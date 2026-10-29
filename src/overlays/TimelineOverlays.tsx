import { createContext, useContext, useState, type ComponentType, type PropsWithChildren } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Tooltip,
} from "@fluentui/react-components";
import { LayerRegular } from "@fluentui/react-icons";
import { Menu, MenuDivider, MenuItem, MenuItemCheckbox, MenuList, MenuPopover, MenuTrigger } from "../components/menu";
import type { OperationsDataset } from "../operations/dataset";
import {
  availableOverlays, changeOverlaySelection, EMPTY_OVERLAY_SELECTION,
  type OverlayId, type OverlayRegistration, type OverlaySelection,
} from "./registry";
import { BufferLayer, BufferProvider, BufferReview, WaitingLayer, WaitingProvider, WaitingReview } from "./StandOverlayFeatures";
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
  if (!available.length) return null;
  const name = selection.enabled.length ? `Overlays: ${selection.enabled.length} enabled` : "Overlays: none enabled";
  return (
    <Menu checkedValues={{ overlays: [...selection.enabled] }}>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={name} relationship="label">
          <Button data-ops-keep-selection="" data-overlay-toolbar="" aria-label={name}
            appearance={selection.enabled.length ? "primary" : "subtle"} icon={<LayerRegular />} />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover data-ops-keep-selection="">
        <MenuList>
          {available.map(feature => (
            <MenuItemCheckbox key={feature.id} name="overlays" value={feature.id}
              title={feature.description} persistOnClick onClick={() => change({ type: "toggle", id: feature.id })}>
              {feature.label}
            </MenuItemCheckbox>
          ))}
          <MenuDivider />
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

export function OverlayReviews() {
  const { dataset, available, selection, change } = useOverlays();
  const feature = available.find(item => item.id === selection.review);
  if (!feature) return null;
  const Review = presentation(feature.id).Review;
  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) change({ type: "close" }); }}>
      <DialogSurface className="timeline-overlay-dialog">
        <DialogBody>
          <DialogTitle>{feature.label}</DialogTitle>
          <DialogContent>
            <p>{dataset.label}. {feature.description}</p>
            <Review dataset={dataset} />
          </DialogContent>
          <DialogActions><Button onClick={() => change({ type: "close" })}>Close</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
