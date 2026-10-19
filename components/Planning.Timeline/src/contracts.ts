export type TimelineItemState = "assigned" | "unassigned" | "excluded";
export type TimelineIntentStatus = "proposed" | "pending" | "accepted" | "rejected" | "cancelled";
export type TimelineFilterEffect = "hide" | "dim";
export type TimelineOverlayInteraction = "none" | "select";

export interface TimelineInterval {
    startUtc: string;
    endUtc: string;
}

export interface TimelineWindow extends TimelineInterval {
    timeZone: string;
}

export interface TimelineRow<TMetadata = Readonly<Record<string, unknown>>> {
    id: string;
    label: string;
    order: number;
    parentId?: string;
    metadata?: TMetadata;
}

export interface TimelineItemVisual {
    shapeToken?: string;
    fillToken?: string;
    patternToken?: string;
    badgeTokens?: readonly string[];
}

export interface TimelineItem<TPayload = unknown> {
    id: string;
    rowId: string | null;
    label: string;
    accessibilityLabel: string;
    state: TimelineItemState;
    displayInterval: TimelineInterval | null;
    reservationInterval: TimelineInterval | null;
    visual?: TimelineItemVisual;
    payload: TPayload;
}

export interface TimelineOverlay<TPayload = unknown> {
    id: string;
    layer: number;
    interval: TimelineInterval;
    rowIds?: readonly string[];
    interaction: TimelineOverlayInteraction;
    payload: TPayload;
}

export interface TimelineFilter<TItem = TimelineItem> {
    id: string;
    effect: TimelineFilterEffect;
    predicate: (item: TItem) => boolean;
}

export interface TimelineRenderContext<TPayload> {
    item: TimelineItem<TPayload>;
    selected: boolean;
    intentStatus?: TimelineIntentStatus;
}

export interface TimelineRenderHooks<TPayload, TRenderNode = unknown> {
    body?: (context: TimelineRenderContext<TPayload>) => TRenderNode;
    label?: (context: TimelineRenderContext<TPayload>) => TRenderNode;
    badges?: (context: TimelineRenderContext<TPayload>) => readonly TRenderNode[];
    details?: (context: TimelineRenderContext<TPayload>) => TRenderNode;
}

export interface TimelineMoveIntent<TPayload = unknown> {
    id: string;
    item: TimelineItem<TPayload>;
    sourceRowId: string | null;
    targetRowId: string;
    originalDisplayInterval: TimelineInterval;
    proposedDisplayInterval: TimelineInterval;
    originalReservationInterval: TimelineInterval | null;
    proposedReservationInterval: TimelineInterval | null;
    status: TimelineIntentStatus;
}
