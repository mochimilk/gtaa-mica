import type { TimelineOverlay } from "./contracts.ts";

export function sortTimelineOverlays<TPayload>(
    overlays: readonly TimelineOverlay<TPayload>[],
): readonly TimelineOverlay<TPayload>[] {
    return [...overlays].sort((left, right) =>
        left.layer - right.layer || left.id.localeCompare(right.id));
}

export function timelineOverlaysForRow<TPayload>(
    overlays: readonly TimelineOverlay<TPayload>[],
    rowId: string,
): readonly TimelineOverlay<TPayload>[] {
    if (!rowId.trim()) {
        throw new RangeError("rowId is required.");
    }
    return sortTimelineOverlays(
        overlays.filter((overlay) =>
            overlay.rowIds === undefined || overlay.rowIds.includes(rowId)),
    );
}
