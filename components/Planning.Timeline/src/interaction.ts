import type {
    TimelineIntentStatus,
    TimelineItem,
    TimelineMoveIntent,
} from "./contracts.ts";
import { requireInterval, shiftInterval, snapDelta } from "./time.ts";

const allowedTransitions: Readonly<Record<TimelineIntentStatus, readonly TimelineIntentStatus[]>> = {
    proposed: ["pending", "cancelled"],
    pending: ["accepted", "rejected", "cancelled"],
    accepted: [],
    rejected: [],
    cancelled: [],
};

export interface ProposeTimelineMoveOptions {
    targetRowId: string;
    pointerTimeMs: number;
    grabOffsetMs: number;
    snapMinutes: number;
    intentId?: string;
}

export function proposeTimelineMove<TPayload>(
    item: TimelineItem<TPayload>,
    options: ProposeTimelineMoveOptions,
): TimelineMoveIntent<TPayload> {
    if (!options.targetRowId.trim()) {
        throw new RangeError("targetRowId is required.");
    }
    if (item.displayInterval === null) {
        throw new RangeError("An item without a display interval cannot be moved on the timeline.");
    }
    const display = requireInterval(item.displayInterval, "item.displayInterval");
    if (!Number.isFinite(options.pointerTimeMs) || !Number.isFinite(options.grabOffsetMs)) {
        throw new RangeError("Pointer time and grab offset must be finite.");
    }

    const desiredStartMs = options.pointerTimeMs - options.grabOffsetMs;
    const deltaMs = snapDelta(desiredStartMs - display.startMs, options.snapMinutes);
    const proposedDisplayInterval = shiftInterval(item.displayInterval, deltaMs);
    const proposedReservationInterval = item.reservationInterval === null
        ? null
        : shiftInterval(item.reservationInterval, deltaMs);

    return {
        id: options.intentId ?? `${item.id}:${options.targetRowId}:${proposedDisplayInterval.startUtc}`,
        item,
        sourceRowId: item.rowId,
        targetRowId: options.targetRowId,
        originalDisplayInterval: item.displayInterval,
        proposedDisplayInterval,
        originalReservationInterval: item.reservationInterval,
        proposedReservationInterval,
        status: "proposed",
    };
}

export function transitionTimelineIntent<TPayload>(
    intent: TimelineMoveIntent<TPayload>,
    status: TimelineIntentStatus,
): TimelineMoveIntent<TPayload> {
    if (!allowedTransitions[intent.status].includes(status)) {
        throw new RangeError(`Timeline intent cannot transition from ${intent.status} to ${status}.`);
    }
    return { ...intent, status };
}
