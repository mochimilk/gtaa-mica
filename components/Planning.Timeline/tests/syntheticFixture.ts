import type {
    TimelineItem,
    TimelineOverlay,
    TimelineRow,
    TimelineWindow,
} from "../src/index.ts";

export interface WorkOrder {
    workOrder: string;
    product: string;
    priority: "normal" | "expedite";
}

export const window: TimelineWindow = {
    startUtc: "2026-10-16T22:00:00.000Z",
    endUtc: "2026-10-17T04:00:00.000Z",
    timeZone: "America/Los_Angeles",
};

export const rows: readonly TimelineRow[] = [
    { id: "cell-cut", label: "Cutting cell", order: 1 },
    { id: "cell-finish", label: "Finishing cell", order: 2 },
];

export const items: readonly TimelineItem<WorkOrder>[] = [
    {
        id: "job-1042",
        rowId: "cell-cut",
        label: "WO-1042",
        accessibilityLabel: "Expedite work order WO-1042 for a bracket in the cutting cell",
        state: "assigned",
        displayInterval: {
            startUtc: "2026-10-16T23:30:00.000Z",
            endUtc: "2026-10-17T00:30:00.000Z",
        },
        reservationInterval: {
            startUtc: "2026-10-16T23:20:00.000Z",
            endUtc: "2026-10-17T00:45:00.000Z",
        },
        visual: {
            shapeToken: "hexagonal",
            fillToken: "expedite",
            badgeTokens: ["quality-hold"],
        },
        payload: {
            workOrder: "WO-1042",
            product: "Bracket",
            priority: "expedite",
        },
    },
    {
        id: "job-unassigned",
        rowId: null,
        label: "WO-1088",
        accessibilityLabel: "Unassigned work order WO-1088 for a housing",
        state: "unassigned",
        displayInterval: null,
        reservationInterval: null,
        payload: {
            workOrder: "WO-1088",
            product: "Housing",
            priority: "normal",
        },
    },
];

export const overlays: readonly TimelineOverlay<{ reason: string }>[] = [
    {
        id: "maintenance-1",
        layer: 10,
        interval: {
            startUtc: "2026-10-17T01:00:00.000Z",
            endUtc: "2026-10-17T02:00:00.000Z",
        },
        rowIds: ["cell-finish"],
        interaction: "select",
        payload: { reason: "Preventive maintenance" },
    },
];
