import {
    applyTimelineFilters,
    autoScrollDelta,
    createTimelineScale,
    parseInterval,
    proposeTimelineMove,
    timelineOverlaysForRow,
    type TimelineFilter,
    type TimelineIntentStatus,
    type TimelineItem,
    type TimelineMoveIntent,
    type TimelineOverlay,
    type TimelineRenderContext,
    type TimelineRenderHooks,
    type TimelineRow,
    type TimelineWindow,
} from "@planning/timeline-core";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type UIEvent,
} from "react";
import React from "react";

const DEFAULT_ROW_HEIGHT = 48;
const DEFAULT_LABEL_WIDTH = 180;
const DEFAULT_SNAP_MINUTES = 5;
const DRAG_THRESHOLD_PX = 5;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

export interface PlanningTimelineProps<
    TItemPayload = unknown,
    TOverlayPayload = unknown,
> {
    ariaLabel?: string;
    viewportTestId?: string;
    rows: readonly TimelineRow[];
    items: readonly TimelineItem<TItemPayload>[];
    overlays?: readonly TimelineOverlay<TOverlayPayload>[];
    filters?: readonly TimelineFilter<TimelineItem<TItemPayload>>[];
    window: TimelineWindow;
    renderers?: TimelineRenderHooks<TItemPayload, ReactNode>;
    renderOverlay?: (overlay: TimelineOverlay<TOverlayPayload>) => ReactNode;
    onOverlaySelect?: (overlay: TimelineOverlay<TOverlayPayload>) => void;
    selectedId?: string | null;
    intentStatusByItemId?: ReadonlyMap<string, TimelineIntentStatus>;
    editable?: boolean;
    initialPxPerMinute?: number;
    pxPerMinute?: number;
    rowHeight?: number;
    labelWidth?: number;
    snapMinutes?: number;
    scrollLeft?: number;
    onScrollLeftChange?: (scrollLeft: number) => void;
    onZoomChange?: (pxPerMinute: number) => void;
    onSelect?: (item: TimelineItem<TItemPayload>) => void;
    onMoveIntent?: (intent: TimelineMoveIntent<TItemPayload>) => void;
}

interface DragState<TPayload> {
    item: TimelineItem<TPayload>;
    startClientX: number;
    startClientY: number;
    lastClientX: number;
    lastClientY: number;
    grabOffsetMs: number;
}

export function PlanningTimeline<TItemPayload, TOverlayPayload>({
    ariaLabel = "Planning timeline",
    viewportTestId = "timeline-viewport",
    rows,
    items,
    overlays = [],
    filters = [],
    window,
    renderers,
    renderOverlay,
    onOverlaySelect,
    selectedId,
    intentStatusByItemId,
    editable = false,
    initialPxPerMinute = 2,
    pxPerMinute: controlledPxPerMinute,
    rowHeight = DEFAULT_ROW_HEIGHT,
    labelWidth = DEFAULT_LABEL_WIDTH,
    snapMinutes = DEFAULT_SNAP_MINUTES,
    scrollLeft,
    onScrollLeftChange,
    onZoomChange,
    onSelect,
    onMoveIntent,
}: PlanningTimelineProps<TItemPayload, TOverlayPayload>) {
    const [internalPxPerMinute, setInternalPxPerMinute] = useState(initialPxPerMinute);
    const pxPerMinute = controlledPxPerMinute ?? internalPxPerMinute;
    const viewportRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState<TItemPayload> | null>(null);
    const scale = useMemo(
        () => createTimelineScale(window, pxPerMinute),
        [window, pxPerMinute],
    );
    const filtered = useMemo(
        () => applyTimelineFilters(items, filters),
        [items, filters],
    );
    const orderedRows = useMemo(
        () => [...rows].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
        [rows],
    );
    const itemsByRow = useMemo(() => {
        const result = new Map<string, TimelineItem<TItemPayload>[]>();
        for (const item of filtered.visible) {
            if (item.rowId === null || item.displayInterval === null) {
                continue;
            }
            const values = result.get(item.rowId) ?? [];
            values.push(item);
            result.set(item.rowId, values);
        }
        return result;
    }, [filtered.visible]);
    const unassigned = filtered.visible.filter((item) => item.state === "unassigned" || item.rowId === null);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (viewport !== null && scrollLeft !== undefined && viewport.scrollLeft !== scrollLeft) {
            viewport.scrollLeft = scrollLeft;
        }
    }, [scrollLeft]);

    const changeZoom = (delta: number) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pxPerMinute + delta));
        if (controlledPxPerMinute === undefined) {
            setInternalPxPerMinute(next);
        }
        onZoomChange?.(next);
    };
    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
        onScrollLeftChange?.(event.currentTarget.scrollLeft);
    };
    const beginDrag = (
        event: ReactPointerEvent<HTMLButtonElement>,
        item: TimelineItem<TItemPayload>,
    ) => {
        if (!editable || item.displayInterval === null) {
            return;
        }
        const track = event.currentTarget.closest<HTMLElement>("[data-timeline-row-id]");
        if (track === null) {
            return;
        }
        const rect = track.getBoundingClientRect();
        const pointerTimeMs = scale.timeForX(event.clientX - rect.left);
        const interval = parseInterval(item.displayInterval);
        if (interval === null) {
            return;
        }
        dragRef.current = {
            item,
            startClientX: event.clientX,
            startClientY: event.clientY,
            lastClientX: event.clientX,
            lastClientY: event.clientY,
            grabOffsetMs: pointerTimeMs - interval.startMs,
        };
    };
    const continueDrag = (event: ReactPointerEvent<HTMLElement>) => {
        if (dragRef.current === null) {
            return;
        }
        dragRef.current.lastClientX = event.clientX;
        dragRef.current.lastClientY = event.clientY;
        const viewport = viewportRef.current;
        if (viewport === null) {
            return;
        }
        const rect = viewport.getBoundingClientRect();
        viewport.scrollLeft += autoScrollDelta(event.clientX - rect.left, rect.width);
        viewport.scrollTop += autoScrollDelta(event.clientY - rect.top, rect.height);
    };
    const completeDrag = (
        event: ReactPointerEvent<HTMLElement>,
    ) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag === null || Math.hypot(
            drag.lastClientX - drag.startClientX,
            drag.lastClientY - drag.startClientY,
        ) < DRAG_THRESHOLD_PX) {
            return;
        }
        const targetTrack = findTrackAtPoint(
            viewportRef.current,
            drag.lastClientX,
            drag.lastClientY,
        );
        const targetRowId = targetTrack?.dataset.timelineRowId;
        if (targetTrack === undefined || targetTrack === null || !targetRowId) {
            return;
        }

        function findTrackAtPoint(
            viewport: HTMLElement | null,
            clientX: number,
            clientY: number,
        ): HTMLElement | null {
            if (viewport === null) {
                return null;
            }
            for (const track of viewport.querySelectorAll<HTMLElement>("[data-timeline-row-id]")) {
                const rect = track.getBoundingClientRect();
                if (
                    clientX >= rect.left
                    && clientX < rect.right
                    && clientY >= rect.top
                    && clientY < rect.bottom
                ) {
                    return track;
                }
            }
            return null;
        }
        const rect = targetTrack.getBoundingClientRect();
        onMoveIntent?.(proposeTimelineMove(drag.item, {
            targetRowId,
            pointerTimeMs: scale.timeForX(drag.lastClientX - rect.left),
            grabOffsetMs: drag.grabOffsetMs,
            snapMinutes,
        }));
    };

    return (
        <section className="planning-timeline" aria-label={ariaLabel}>
            <div className="planning-timeline__toolbar">
                <button type="button" aria-label="Zoom out" onClick={() => changeZoom(-0.5)}>−</button>
                <output aria-label="Timeline zoom">{pxPerMinute.toFixed(1)} px/min</output>
                <button type="button" aria-label="Zoom in" onClick={() => changeZoom(0.5)}>+</button>
            </div>
            <div
                className="planning-timeline__viewport"
                ref={viewportRef}
                onScroll={handleScroll}
                onPointerMove={continueDrag}
                onPointerUp={completeDrag}
                data-testid={viewportTestId}
            >
                <div
                    className="planning-timeline__canvas"
                    style={{ width: labelWidth + scale.width }}
                >
                    <TimelineHeader
                        labelWidth={labelWidth}
                        scale={scale}
                        timeZone={window.timeZone}
                    />
                    {orderedRows.map((row) => (
                        <div
                            className="planning-timeline__row"
                            key={row.id}
                            style={{ height: rowHeight }}
                        >
                            <div
                                className="planning-timeline__row-label"
                                style={{ width: labelWidth }}
                            >
                                {row.label}
                            </div>
                            <div
                                className="planning-timeline__track"
                                data-timeline-row-id={row.id}
                                style={{ width: scale.width }}
                            >
                                {timelineOverlaysForRow(overlays, row.id).map((overlay) => {
                                    const geometry = scale.geometry(overlay.interval);
                                    return geometry === null ? null : (
                                        <TimelineOverlayBlock
                                            key={overlay.id}
                                            overlay={overlay}
                                            geometry={geometry}
                                            renderOverlay={renderOverlay}
                                            onSelect={onOverlaySelect}
                                        />
                                    );
                                })}
                                {(itemsByRow.get(row.id) ?? []).map((item) => {
                                    const geometry = scale.geometry(item.displayInterval!);
                                    return geometry === null ? null : (
                                        <TimelineItemButton
                                            key={item.id}
                                            item={item}
                                            geometry={geometry}
                                            selected={selectedId === item.id}
                                            dimmed={filtered.dimmedIds.has(item.id)}
                                            editable={editable}
                                            intentStatus={intentStatusByItemId?.get(item.id)}
                                            renderers={renderers}
                                            onClick={() => onSelect?.(item)}
                                            onPointerDown={beginDrag}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            {unassigned.length > 0 && (
                <section className="planning-timeline__unassigned" aria-label="Unassigned items">
                    <h3>Unassigned</h3>
                    <div className="planning-timeline__unassigned-list">
                        {unassigned.map((item) => (
                            <button
                                type="button"
                                key={item.id}
                                aria-label={item.accessibilityLabel}
                                data-item-id={item.id}
                                onClick={() => onSelect?.(item)}
                            >
                                {renderers?.label?.(renderContext(item, selectedId === item.id, intentStatusByItemId))
                                    ?? item.label}
                            </button>
                        ))}
                    </div>
                </section>
            )}
        </section>
    );
}

interface TimelineHeaderProps {
    labelWidth: number;
    scale: ReturnType<typeof createTimelineScale>;
    timeZone: string;
}

function TimelineHeader({ labelWidth, scale, timeZone }: TimelineHeaderProps) {
    const firstHour = Math.ceil(scale.window.startMs / 3_600_000) * 3_600_000;
    const ticks: number[] = [];
    for (let value = firstHour; value < scale.window.endMs; value += 3_600_000) {
        ticks.push(value);
    }
    return (
        <div className="planning-timeline__header">
            <div className="planning-timeline__corner" style={{ width: labelWidth }}>Resource</div>
            <div className="planning-timeline__time-header" style={{ width: scale.width }}>
                {ticks.map((tick) => (
                    <time
                        dateTime={new Date(tick).toISOString()}
                        key={tick}
                        style={{ left: scale.xForTime(tick) }}
                    >
                        {new Date(tick).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone,
                        })}
                    </time>
                ))}
            </div>
        </div>
    );
}

interface TimelineOverlayBlockProps<TPayload> {
    overlay: TimelineOverlay<TPayload>;
    geometry: { left: number; width: number };
    renderOverlay?: ((overlay: TimelineOverlay<TPayload>) => ReactNode) | undefined;
    onSelect?: ((overlay: TimelineOverlay<TPayload>) => void) | undefined;
}

function TimelineOverlayBlock<TPayload>({
    overlay,
    geometry,
    renderOverlay,
    onSelect,
}: TimelineOverlayBlockProps<TPayload>) {
    const style: CSSProperties = {
        left: geometry.left,
        width: geometry.width,
        zIndex: overlay.layer,
    };
    if (overlay.interaction === "select") {
        return (
            <button
                type="button"
                className="planning-timeline__overlay"
                data-overlay-id={overlay.id}
                style={style}
                onClick={() => onSelect?.(overlay)}
            >
                {renderOverlay?.(overlay)}
            </button>
        );
    }
    return (
        <div
            className="planning-timeline__overlay"
            data-overlay-id={overlay.id}
            style={style}
        >
            {renderOverlay?.(overlay)}
        </div>
    );
}

interface TimelineItemButtonProps<TPayload> {
    item: TimelineItem<TPayload>;
    geometry: { left: number; width: number };
    selected: boolean;
    dimmed: boolean;
    editable: boolean;
    intentStatus?: TimelineIntentStatus | undefined;
    renderers?: TimelineRenderHooks<TPayload, ReactNode> | undefined;
    onClick: () => void;
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, item: TimelineItem<TPayload>) => void;
}

function TimelineItemButton<TPayload>({
    item,
    geometry,
    selected,
    dimmed,
    editable,
    intentStatus,
    renderers,
    onClick,
    onPointerDown,
}: TimelineItemButtonProps<TPayload>) {
    const context: TimelineRenderContext<TPayload> = intentStatus === undefined
        ? { item, selected }
        : { item, selected, intentStatus };
    const style: CSSProperties = {
        left: geometry.left,
        width: Math.max(geometry.width, 2),
    };
    return (
        <button
            type="button"
            className="planning-timeline__item"
            style={style}
            aria-label={item.accessibilityLabel}
            aria-pressed={selected}
            data-item-id={item.id}
            data-shape={item.visual?.shapeToken}
            data-fill={item.visual?.fillToken}
            data-pattern={item.visual?.patternToken}
            data-dimmed={dimmed || undefined}
            data-editable={editable || undefined}
            data-intent-status={intentStatus}
            onClick={onClick}
            onPointerDown={(event) => onPointerDown(event, item)}
        >
            <span className="planning-timeline__item-body">
                {renderers?.body?.(context)}
                <span className="planning-timeline__item-label">
                    {renderers?.label?.(context) ?? item.label}
                </span>
                <span className="planning-timeline__item-badges">
                    {renderers?.badges?.(context)
                        ?? item.visual?.badgeTokens?.map((badge) => (
                            <span key={badge}>{badge}</span>
                        ))}
                </span>
            </span>
            {renderers?.details !== undefined && (
                <span className="planning-timeline__item-details" role="tooltip">
                    {renderers.details(context)}
                </span>
            )}
        </button>
    );
}

function renderContext<TPayload>(
    item: TimelineItem<TPayload>,
    selected: boolean,
    statuses: ReadonlyMap<string, TimelineIntentStatus> | undefined,
): TimelineRenderContext<TPayload> {
    const intentStatus = statuses?.get(item.id);
    return intentStatus === undefined ? { item, selected } : { item, selected, intentStatus };
}
