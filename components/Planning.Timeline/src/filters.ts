import type { TimelineFilter, TimelineItem } from "./contracts.ts";

export interface TimelineFilterResult<TItem> {
    visible: readonly TItem[];
    dimmedIds: ReadonlySet<string>;
}

export function applyTimelineFilters<TItem extends TimelineItem>(
    items: readonly TItem[],
    filters: readonly TimelineFilter<TItem>[],
): TimelineFilterResult<TItem> {
    const hideFilters = filters.filter((filter) => filter.effect === "hide");
    const dimFilters = filters.filter((filter) => filter.effect === "dim");
    const visible = items.filter((item) => hideFilters.every((filter) => filter.predicate(item)));
    const dimmedIds = new Set(
        visible
            .filter((item) => dimFilters.some((filter) => !filter.predicate(item)))
            .map((item) => item.id),
    );
    return { visible, dimmedIds };
}
