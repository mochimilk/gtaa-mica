// App-owned host state shared by the chart and the operations panel.
// The reusable chart never imports this; it only receives selectedIds/onIntent.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from "react";
import { isSkyeEvent } from "../components/agent-cursor";
import type { ChartIntent } from "../stand-timeline";
import { applySelection } from "../stand-timeline-demo/selection";
import type { FlightStyle } from "../stand-timeline-demo/theme";
import {
  allocationVersion as readAllocationVersion,
  applyAssigns,
  applyPlan,
  checkSwap,
  flightsAtStay,
  occupancyById,
  resetStands as resetAllStands,
  setClosure,
  subscribeAllocation,
  unassignStays,
  type Closure,
  type DropPlan,
  type StandAssign,
} from "./allocation";
import { planBoardDrop, waitingFlight } from "./noStandLane";
import { approveSkyeChanges, asUser, undoSkyeChanges } from "./skyeReview";
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
   * Flight picked in the panel, or by its bar in the No stand lane. Set for
   * both assigned and unassigned flights; cleared whenever the chart changes
   * the selection otherwise.
   */
  flightId: string | null;
}

/**
 * The user's swap (a drop, the Swap button), waiting for their Approve or
 * Cancel (see SwapConfirm). Skye's swaps are not asked about first: like all
 * her stand changes, they wait for approval once made (see ./skyeReview).
 */
export interface SwapRequest {
  occupancyId: string;
  otherId: string;
}

/** Where the latest selection was made; picks the details popover anchor fallback. */
export type SelectionSource = "chart" | "list" | "alert";

export interface OperationsValue {
  /**
   * The user's selection, and the details popover that goes with it. The
   * user and Skye work the board side by side: what Skye selects is
   * `skyeSelection`, kept apart, so neither ever replaces or clears the
   * other's, and Skye never opens, closes or re-targets the user's details.
   */
  selection: OpsSelection;
  /** What Skye has selected (outlined in its orb's colours), apart from the user's. */
  skyeSelection: OpsSelection;
  /**
   * Runs `act` as Skye: any selection it makes is Skye's. So are the
   * selections Skye's cursors make by clicking (see isSkyeEvent).
   */
  actAsSkye: <T>(act: () => T) => T;
  applyChartIntent: (intent: ChartIntent) => void;
  selectFlight: (flight: OpsFlight, source?: SelectionSource) => void;
  /**
   * Selects the stays of several flights on the chart, as Ctrl-clicking their
   * bars does: "replace" starts over, "add" keeps what is selected. Flights
   * without a stand have no bar and are skipped.
   */
  selectFlights: (flights: readonly OpsFlight[], mode: "replace" | "add") => void;
  clearSelection: () => void;
  /**
   * Undoes Skye's changes waiting to be approved (see ./skyeReview) and
   * clears the board's selections, the user's and hers alike.
   */
  undoSkyeChanges: () => void;
  /**
   * Approves Skye's changes waiting (see ./skyeReview), once everyone before
   * the user has, and clears what she has selected; the user's selection stays.
   */
  approveSkyeChanges: () => void;
  /**
   * Increments on every demo stand change (a move, swap, assignment or
   * unassignment), so stand-derived
   * views re-render. The changes themselves live in ./allocation.
   */
  allocationVersion: number;
  /**
   * Carries out a move or swap plan from ./allocation that needs no more
   * asking: a move selects the stay and opens its details, a swap selects
   * both stays and leaves the details closed. Does nothing for a conflict.
   */
  applyStandPlan: (plan: DropPlan) => boolean;
  /**
   * The user's swap (the Swap button): asks first beside the two stays, and
   * swaps only when they approve.
   */
  requestSwap: (occupancyId: string, otherId: string) => void;
  /** The swap awaiting an answer, shown by SwapConfirm. */
  swapRequest: SwapRequest | null;
  /** SwapConfirm's answer: Approve (true) or Cancel (false). */
  answerSwap: (approved: boolean) => void;
  /**
   * Puts every stay back on its fixture stand and times, and reopens any
   * closed area. Skye's changes waiting to be approved go with them.
   */
  resetStands: () => void;
  /**
   * Runs `work` (Skye's cursors dragging several stays at once) with the
   * chart's drops landing quietly: a moved stay is neither selected nor
   * shown in the details. The selection is cleared first, so the board is
   * clear to work on, and the board is held (`boardHeld`) until it is done.
   */
  runSkyeBatch: <T>(work: () => Promise<T>) => Promise<T>;
  /**
   * True while runSkyeBatch runs: the No stand lane keeps its rows as flights
   * leave it, so the stands below do not shift under Skye's other cursors.
   */
  boardHeld: boolean;
  /**
   * Closes a stand area and carries out `plans`, the moves that clear it
   * (planned and checked by ./allocation), all at once. Then selects
   * `highlightIds`, the stays that moved, with the details closed.
   */
  closeArea: (
    closure: Closure,
    plans: readonly Extract<DropPlan, { kind: "move" }>[],
    highlightIds: readonly string[],
  ) => void;
  /**
   * Gives stands to stays that have none (planned and checked by
   * ./allocation), all at once, and selects every one of them now on its
   * stand; one alone also shows its details, as a move does. Inside
   * runSkyeBatch it only places them. Returns the stays it placed.
   */
  assignStands: (assigns: readonly StandAssign[]) => string[];
  /**
   * Fixes everything at once: carries out `plans` (moves) and `assigns`
   * (planned and checked by ./allocation), skipping any already made, then
   * selects `highlightIds`, what changed, with the details closed.
   */
  applyFixes: (
    plans: readonly Extract<DropPlan, { kind: "move" }>[],
    assigns: readonly StandAssign[],
    highlightIds: readonly string[],
  ) => void;
  /**
   * Takes stays off their stands, into the No stand lane. One alone leaves
   * its flight selected, so its details offer to give it a stand again;
   * inside runSkyeBatch it only takes them off. Returns the stays taken off.
   */
  unassignStands: (stayIds: readonly string[]) => string[];
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
  /** How flights are drawn on the board and in their cards (the View menu's Timeline row); aero by default. */
  flightStyle: FlightStyle;
  setFlightStyle: (style: FlightStyle) => void;
}

const OperationsContext = createContext<OperationsValue | null>(null);

const EMPTY: OpsSelection = { occupancyIds: [], flightId: null };

export function OperationsProvider({ children }: { children: ReactNode }) {
  const [selection, setUserSelection] = useState<OpsSelection>(EMPTY);
  const [skyeSelection, setSkyeSelection] = useState<OpsSelection>(EMPTY);
  const skyeActing = useRef(false);
  /** Whether what is happening now is Skye's doing: her cursors' events, or a change made through actAsSkye. */
  const bySkye = () => isSkyeEvent() || skyeActing.current;
  // Every selection goes to whoever made it.
  const setSelection = useCallback((next: SetStateAction<OpsSelection>) => {
    if (bySkye()) setSkyeSelection(next);
    else setUserSelection(next);
  }, []);
  const actAsSkye = useCallback(<T,>(act: () => T): T => {
    const was = skyeActing.current;
    skyeActing.current = true;
    try {
      return act();
    } finally {
      skyeActing.current = was;
    }
  }, []);
  const [acknowledged, setAck] = useState<ReadonlySet<string>>(new Set());
  // The details popover, what it is anchored to and when it re-resolves are
  // the user's: Skye's doings leave them alone.
  const [detailsOpen, setDetailsOpenState] = useState(false);
  const setDetailsOpen = useCallback((open: boolean) => {
    if (!bySkye()) setDetailsOpenState(open);
  }, []);
  const [selectionSource, setSelectionSourceState] = useState<SelectionSource>("chart");
  const setSelectionSource = useCallback((source: SelectionSource) => {
    if (!bySkye()) setSelectionSourceState(source);
  }, []);
  const [selectionRequest, setSelectionRequestState] = useState(0);
  const setSelectionRequest = useCallback((update: (n: number) => number) => {
    if (!bySkye()) setSelectionRequestState(update);
  }, []);

  const allocationVersion = useSyncExternalStore(subscribeAllocation, readAllocationVersion);

  // Open while Skye works several stays at once (runSkyeBatch).
  const skyeBatch = useRef(0);
  const [boardHeld, setBoardHeld] = useState(false);

  const applyStandPlan = useCallback((plan: DropPlan) => {
    if (!applyPlan(plan)) return false;
    // One of several stays Skye is moving at once: it just lands.
    if (skyeBatch.current > 0) return true;
    if (plan.kind === "swap") {
      // Both stays stay highlighted; a swap does not open the details.
      setSelection({ occupancyIds: [plan.occupancyId, plan.otherId], flightId: null });
      setDetailsOpen(false);
      return true;
    }
    // A moved stay is selected, so its details show where it landed.
    setSelection({ occupancyIds: [plan.occupancyId], flightId: null });
    setSelectionSource("chart");
    setSelectionRequest((n) => n + 1);
    setDetailsOpen(true);
    return true;
  }, []);

  // One thing the user did, in the Outputs panel, undoing Skye's changes and all.
  const resetStands = useCallback(
    () =>
      asUser("Reset stands", () => {
        undoSkyeChanges();
        resetAllStands();
      }),
    [],
  );

  const runSkyeBatch = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    skyeBatch.current += 1;
    setBoardHeld(true);
    // Skye's own selection only: the user's stays as it is.
    setSkyeSelection(EMPTY);
    try {
      return await work();
    } finally {
      skyeBatch.current -= 1;
      if (skyeBatch.current === 0) setBoardHeld(false);
    }
  }, []);

  const closeArea = useCallback<OperationsValue["closeArea"]>((closure, plans, highlightIds) => {
    setClosure(closure);
    for (const plan of plans) applyPlan(plan);
    setSelection({ occupancyIds: [...highlightIds], flightId: null });
    setDetailsOpen(false);
  }, []);

  const assignStands = useCallback((assigns: readonly StandAssign[]) => {
    const placed = applyAssigns(assigns);
    // One of several flights Skye is placing one after another: it just lands.
    if (skyeBatch.current > 0) return placed;
    // Everything asked for that is on its stand now, including what an
    // earlier drop already placed, so the whole result shows.
    const onStand = assigns
      .filter((assign) => occupancyById(assign.stayId)?.rowId === assign.standId)
      .map((assign) => assign.stayId);
    if (onStand.length === 0) return placed;
    setSelection({ occupancyIds: onStand, flightId: null });
    setSelectionSource("chart");
    setSelectionRequest((n) => n + 1);
    setDetailsOpen(onStand.length === 1);
    return placed;
  }, []);

  const applyFixes = useCallback<OperationsValue["applyFixes"]>((plans, assigns, highlightIds) => {
    for (const plan of plans) applyPlan(plan);
    applyAssigns(assigns);
    setSelection({ occupancyIds: [...new Set(highlightIds)].filter((id) => occupancyById(id)), flightId: null });
    setDetailsOpen(false);
  }, []);

  const unassignStands = useCallback((stayIds: readonly string[]) => {
    // Read first: once off its stand the stay's flights no longer point at it.
    const flight = stayIds.length === 1 ? flightsAtStay(stayIds[0])[0] : undefined;
    const removed = unassignStays(stayIds);
    // One of several stays Skye is taking off one after another: it just goes.
    if (removed.length === 0 || skyeBatch.current > 0) return removed;
    if (removed.length === 1 && flight) {
      setSelection({ occupancyIds: [], flightId: flight.id });
      setSelectionSource("list");
      setSelectionRequest((n) => n + 1);
      setDetailsOpen(true);
    } else {
      setSelection(EMPTY);
      setDetailsOpen(false);
    }
    return removed;
  }, []);

  // One swap question at a time; a newer one cancels the older.
  const [swapRequest, setSwapRequest] = useState<SwapRequest | null>(null);
  const pendingSwap = useRef<{ request: SwapRequest; resolve: (approved: boolean) => void } | null>(null);

  const askSwap = useCallback(
    (request: SwapRequest) =>
      new Promise<boolean>((resolve) => {
        pendingSwap.current?.resolve(false);
        pendingSwap.current = { request, resolve };
        // The pair is selected (outlined, and linked by the swap line) while
        // the question shows beside it, with the details making way.
        setUserSelection({ occupancyIds: [request.occupancyId, request.otherId], flightId: null });
        setDetailsOpenState(false);
        setSwapRequest(request);
      }),
    [],
  );

  const answerSwap = useCallback((approved: boolean) => {
    const pending = pendingSwap.current;
    if (!pending) return;
    pendingSwap.current = null;
    setSwapRequest(null);
    pending.resolve(approved);
  }, []);

  const requestSwap = useCallback(
    (occupancyId: string, otherId: string) => {
      void askSwap({ occupancyId, otherId }).then((approved) => {
        // Checked again: the board may have changed while the question was open.
        if (approved && checkSwap(occupancyId, otherId).ok) applyStandPlan({ kind: "swap", occupancyId, otherId });
      });
    },
    [askSwap, applyStandPlan],
  );

  /**
   * A drop on the chart. Onto free time it moves at once; onto a stay it can
   * trade with, the user is asked first. Skye's drops land at once: what she
   * changes waits for approval once made (see ./skyeReview).
   */
  const dropStay = useCallback(
    (plan: DropPlan) => {
      if (plan.kind !== "move" && plan.kind !== "swap") return;
      if (plan.kind === "swap" && !bySkye()) requestSwap(plan.occupancyId, plan.otherId);
      else applyStandPlan(plan);
    },
    [applyStandPlan, requestSwap],
  );

  const selectFlight = useCallback((flight: OpsFlight, source: SelectionSource = "list") => {
    setSelection({
      occupancyIds: flight.occupancyId ? [flight.occupancyId] : [],
      flightId: flight.id,
    });
    setSelectionSource(source);
    setSelectionRequest((n) => n + 1);
    setDetailsOpen(true);
  }, []);

  const applyChartIntent = useCallback((intent: ChartIntent) => {
    if (intent.type === "move") {
      // Down out of the No stand lane gives a stand; up into it takes one away.
      const drop = planBoardDrop(intent.occupancyId, intent.rowId, intent.shiftMs);
      if (drop.kind === "assign") assignStands([{ stayId: drop.stayId, standId: drop.standId }]);
      else if (drop.kind === "unassign") unassignStands([drop.stayId]);
      else dropStay(drop);
      return;
    }
    // A bar in the No stand lane stands for its waiting flight: picking it
    // picks the flight, so its details offer it a stand.
    const waiting = intent.occupancyIds.length === 1 ? waitingFlight(intent.occupancyIds[0]) : undefined;
    if (waiting) {
      selectFlight(waiting, "chart");
      return;
    }
    // Same reducer as before. Opens the details; the effect below closes them
    // again if the intent left nothing selected (e.g. Esc or empty-area click).
    setSelection((cur) => ({ occupancyIds: applySelection(cur.occupancyIds, intent), flightId: null }));
    setSelectionSource("chart");
    setSelectionRequest((n) => n + 1);
    setDetailsOpen(true);
  }, [assignStands, unassignStands, dropStay, selectFlight]);

  useEffect(() => {
    if (selection.occupancyIds.length === 0 && !selection.flightId) setDetailsOpen(false);
  }, [selection]);

  const selectFlights = useCallback((flights: readonly OpsFlight[], mode: "replace" | "add") => {
    const ids = flights.flatMap((flight) => (flight.occupancyId ? [flight.occupancyId] : []));
    // Kept in click order: the last one anchors the details.
    setSelection((cur) => {
      const base = mode === "add" ? cur.occupancyIds : [];
      return { occupancyIds: [...new Set([...base, ...ids])], flightId: null };
    });
    setSelectionSource("chart");
    setSelectionRequest((n) => n + 1);
    setDetailsOpen(true);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(EMPTY);
    setDetailsOpen(false);
  }, []);

  const approveSkye = useCallback(() => {
    if (approveSkyeChanges()) setSkyeSelection(EMPTY);
  }, []);

  const undoSkye = useCallback(() => {
    undoSkyeChanges();
    setUserSelection(EMPTY);
    setSkyeSelection(EMPTY);
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
  const [flightStyle, setFlightStyle] = useState<FlightStyle>("aero");
  // Recomputed when the view, filters or acknowledgements change ("Needs
  // attention" follows open alerts).
  // Stand changes move stays between areas; allocationVersion rebuilds it for
  // memoised consumers, since it reads the (mutable) stands live.
  const matcher = useMemo(
    () => makeMatcher(view, filters, acknowledged),
    [view, filters, acknowledged, allocationVersion],
  );

  const value = useMemo(
    () => ({
      selection,
      skyeSelection,
      actAsSkye,
      applyChartIntent,
      selectFlight,
      selectFlights,
      clearSelection,
      undoSkyeChanges: undoSkye,
      approveSkyeChanges: approveSkye,
      allocationVersion,
      applyStandPlan,
      resetStands,
      runSkyeBatch,
      boardHeld,
      closeArea,
      assignStands,
      applyFixes,
      unassignStands,
      requestSwap,
      swapRequest,
      answerSwap,
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
      flightStyle,
      setFlightStyle,
    }),
    [
      selection,
      skyeSelection,
      actAsSkye,
      applyChartIntent,
      selectFlight,
      selectFlights,
      clearSelection,
      undoSkye,
      approveSkye,
      allocationVersion,
      applyStandPlan,
      resetStands,
      runSkyeBatch,
      boardHeld,
      closeArea,
      assignStands,
      applyFixes,
      unassignStands,
      requestSwap,
      swapRequest,
      answerSwap,
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
      flightStyle,
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
