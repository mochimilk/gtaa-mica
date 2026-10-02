// App-owned host state shared by the chart and the operations panel.
// The reusable chart never imports this; it only receives selectedIds/onIntent.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChartIntent } from "../stand-timeline";
import { applySelection } from "../stand-timeline-demo/selection";
import { OPS_FLIGHTS_BY_ID, type OpsFlight } from "./operationsData";
import {
  EMPTY_FILTERS,
  makeMatcher,
  type FilterDim,
  type OpsFilters,
  type OpsMatcher,
  type ViewKey,
} from "./opsFilters";

export interface OpsSelection {
  /** Selected chart occupancies (shared with the chart). */
  occupancyIds: string[];
  /**
   * Flight picked in the panel. Set for both assigned and unassigned flights;
   * cleared whenever the chart changes the selection.
   */
  flightId: string | null;
}

/** Where the latest selection was made; picks the details popover anchor fallback. */
export type SelectionSource = "chart" | "list" | "alert";

export interface OperationsValue {
  selection: OpsSelection;
  applyChartIntent: (intent: ChartIntent) => void;
  selectFlight: (flight: OpsFlight, source?: SelectionSource) => void;
  clearSelection: () => void;
  /**
   * Selection details popover. Every non-empty selection opens it; the
   * popover's dismissals clear the selection, and clearing closes it.
   */
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  selectionSource: SelectionSource;
  /** Increments on every selection request, so reselecting the same item reopens. */
  selectionRequest: number;
  /** Local demo-only acknowledgement; nothing is persisted or sent. */
  acknowledged: ReadonlySet<string>;
  setAcknowledged: (alertId: string, value: boolean) => void;
  /** Views (one at a time) and Filters (OR within, AND across; empty = all). */
  view: ViewKey;
  setView: (view: ViewKey) => void;
  filters: OpsFilters;
  setFilter: (dim: FilterDim, values: string[]) => void;
  resetFilters: () => void;
  /** Matching predicates for the current view/filters (chart, lists, alerts). */
  matcher: OpsMatcher;
}

const OperationsContext = createContext<OperationsValue | null>(null);

const EMPTY: OpsSelection = { occupancyIds: [], flightId: null };

export function OperationsProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<OpsSelection>(EMPTY);
  const [acknowledged, setAck] = useState<ReadonlySet<string>>(new Set());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectionSource, setSelectionSource] = useState<SelectionSource>("chart");
  const [selectionRequest, setSelectionRequest] = useState(0);

  const applyChartIntent = useCallback((intent: ChartIntent) => {
    if (intent.type !== "select") return;
    // Same reducer as before. Opens the details; the effect below closes them
    // again if the intent left nothing selected (e.g. Esc or empty-area click).
    setSelection((cur) => ({ occupancyIds: applySelection(cur.occupancyIds, intent), flightId: null }));
    setSelectionSource("chart");
    setSelectionRequest((n) => n + 1);
    setDetailsOpen(true);
  }, []);

  useEffect(() => {
    if (selection.occupancyIds.length === 0 && !selection.flightId) setDetailsOpen(false);
  }, [selection]);

  const selectFlight = useCallback((flight: OpsFlight, source: SelectionSource = "list") => {
    setSelection({
      occupancyIds: flight.occupancyId ? [flight.occupancyId] : [],
      flightId: flight.id,
    });
    setSelectionSource(source);
    setSelectionRequest((n) => n + 1);
    setDetailsOpen(true);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(EMPTY);
    setDetailsOpen(false);
  }, []);

  const setAcknowledged = useCallback((alertId: string, value: boolean) => {
    setAck((cur) => {
      const next = new Set(cur);
      if (value) next.add(alertId);
      else next.delete(alertId);
      return next;
    });
  }, []);

  const [view, setView] = useState<ViewKey>("all");
  const [filters, setFilters] = useState<OpsFilters>(EMPTY_FILTERS);
  const setFilter = useCallback(
    (dim: FilterDim, values: string[]) => setFilters((cur) => ({ ...cur, [dim]: values })),
    [],
  );
  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  // Recomputed when the view, filters or acknowledgements change ("Needs
  // attention" follows open alerts).
  const matcher = useMemo(
    () => makeMatcher(view, filters, acknowledged),
    [view, filters, acknowledged],
  );

  const value = useMemo(
    () => ({
      selection,
      applyChartIntent,
      selectFlight,
      clearSelection,
      detailsOpen,
      setDetailsOpen,
      selectionSource,
      selectionRequest,
      acknowledged,
      setAcknowledged,
      view,
      setView,
      filters,
      setFilter,
      resetFilters,
      matcher,
    }),
    [
      selection,
      applyChartIntent,
      selectFlight,
      clearSelection,
      detailsOpen,
      selectionSource,
      selectionRequest,
      acknowledged,
      setAcknowledged,
      view,
      filters,
      setFilter,
      resetFilters,
      matcher,
    ],
  );
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations(): OperationsValue {
  const ctx = useContext(OperationsContext);
  if (!ctx) throw new Error("useOperations must be used inside <OperationsProvider>");
  return ctx;
}

/**
 * Whether a flight row is selected: the panel-picked flight if there is one,
 * otherwise every flight whose endpoint stay is selected on the chart.
 */
export function isFlightSelected(flight: OpsFlight, selection: OpsSelection): boolean {
  if (selection.flightId) return selection.flightId === flight.id;
  return !!flight.occupancyId && selection.occupancyIds.includes(flight.occupancyId);
}

export function selectedFlight(selection: OpsSelection): OpsFlight | undefined {
  return selection.flightId ? OPS_FLIGHTS_BY_ID.get(selection.flightId) : undefined;
}
