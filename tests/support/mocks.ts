// Test doubles for the voice session.
//
// Nothing here touches a network, a real microphone, a real RTCPeerConnection
// or any API. Timers are virtual, so lifecycle ordering is asserted rather
// than waited on.
import { buildSnapshot, type OperationsHost, type OpsSnapshot } from "../../src/live/opsHost.ts";
import { applyAssigns, applyPlan, occupancyById, setClosure, unassignStays } from "../../src/operations/allocation.ts";
import { inviteToCall, removeFromCall as removeGuest } from "../../src/live/callGuests.ts";
import { OPS_FLIGHTS_BY_ID } from "../../src/operations/operationsData.ts";
import { EMPTY_FILTERS, type FilterDim, type OpsFilters, type ViewKey } from "../../src/operations/opsFilters.ts";

/** Lets pending promise callbacks run. */
export function flush(times = 6): Promise<void> {
  let chain = Promise.resolve();
  for (let index = 0; index < times; index += 1) {
    chain = chain.then(() => new Promise<void>((resolve) => setImmediate(resolve)));
  }
  return chain;
}

/* ------------------------------------------------------------- scheduler */

export type Scheduler = {
  schedule: (callback: () => void, delayMs: number) => () => void;
  /** Runs everything due within `ms`, in due order. */
  advance: (ms: number) => void;
  readonly pending: number;
};

export function createScheduler(): Scheduler {
  type Task = { at: number; seq: number; callback: () => void };
  const tasks: Task[] = [];
  let now = 0;
  let seq = 0;

  return {
    schedule(callback, delayMs) {
      const task: Task = { at: now + delayMs, seq: (seq += 1), callback };
      tasks.push(task);
      return () => {
        const index = tasks.indexOf(task);
        if (index >= 0) tasks.splice(index, 1);
      };
    },
    advance(ms) {
      now += ms;
      for (;;) {
        const due = tasks.filter((task) => task.at <= now).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        tasks.splice(tasks.indexOf(due), 1);
        due.callback();
      }
    },
    get pending() {
      return tasks.length;
    },
  };
}

/* ----------------------------------------------------------- operations */

export type FakeHost = OperationsHost & {
  /** Every mutation, in order, for asserting that nothing stale was applied. */
  readonly calls: string[];
  /** Simulates the user changing the board by hand. */
  bumpRevision: () => number;
  readonly revision: number;
};

export function createFakeHost(
  initial: {
    view?: ViewKey;
    filters?: OpsFilters;
    acknowledged?: string[];
    selection?: { occupancyIds: string[]; flightId: string | null };
  } = {},
): FakeHost {
  let view: ViewKey = initial.view ?? "all";
  let filters: OpsFilters = initial.filters ?? EMPTY_FILTERS;
  let acknowledged = new Set(initial.acknowledged ?? []);
  let selection = initial.selection ?? { occupancyIds: [] as string[], flightId: null as string | null };
  let revision = 1;
  const calls: string[] = [];

  return {
    calls,
    get revision() {
      return revision;
    },
    bumpRevision() {
      revision += 1;
      return revision;
    },
    snapshot(): OpsSnapshot {
      return buildSnapshot({ revision, view, filters, acknowledged, selection });
    },
    selectFlight(flightId) {
      calls.push(`selectFlight:${flightId}`);
      selection = { occupancyIds: [], flightId };
      revision += 1;
    },
    selectFlights(flightIds, mode) {
      calls.push(`selectFlights:${mode}:${flightIds.join("|")}`);
      const ids = flightIds.flatMap((id) => OPS_FLIGHTS_BY_ID.get(id)?.occupancyId ?? []);
      const base = mode === "add" ? selection.occupancyIds : [];
      selection = { occupancyIds: [...new Set([...base, ...ids])], flightId: null };
      revision += 1;
    },
    clearSelection() {
      calls.push("clearSelection");
      selection = { occupancyIds: [], flightId: null };
      revision += 1;
    },
    setView(next) {
      calls.push(`setView:${next}`);
      view = next;
      revision += 1;
    },
    setFilter(dimension: FilterDim, values) {
      calls.push(`setFilter:${dimension}:${values.join("|")}`);
      filters = { ...filters, [dimension]: values };
      revision += 1;
    },
    resetFilters() {
      calls.push("resetFilters");
      filters = EMPTY_FILTERS;
      revision += 1;
    },
    applyStandPlan(plan) {
      // The real stand state, so later plans see it; reset it between tests.
      calls.push(plan.kind === "move" ? `move:${plan.occupancyId}:${plan.standId}` : `swap:${plan.occupancyId}:${plan.otherId}`);
      applyPlan(plan);
      revision += 1;
    },
    closeArea(closure, plans, highlightIds) {
      calls.push(`closeArea:${closure.area}:${plans.length}`);
      setClosure(closure);
      for (const plan of plans) applyPlan(plan);
      selection = { occupancyIds: [...highlightIds], flightId: null };
      revision += 1;
    },
    assignStands(assigns) {
      calls.push(`assignStands:${assigns.map((assign) => `${assign.stayId}>${assign.standId}`).join("|")}`);
      applyAssigns(assigns);
      // Selects all of them on their stands, as the app does.
      selection = {
        occupancyIds: assigns.filter((assign) => occupancyById(assign.stayId)?.rowId === assign.standId).map((assign) => assign.stayId),
        flightId: null,
      };
      revision += 1;
    },
    applyFixes(plans, assigns, highlightIds) {
      calls.push(`applyFixes:${plans.length}:${assigns.length}`);
      for (const plan of plans) applyPlan(plan);
      applyAssigns(assigns);
      selection = { occupancyIds: highlightIds.filter((id) => occupancyById(id)), flightId: null };
      revision += 1;
    },
    showAlerts(mentioned) {
      calls.push(`showAlerts:${mentioned ?? ""}`);
    },
    hideAlerts() {
      calls.push("hideAlerts");
    },
    addToCall(person) {
      calls.push(`addToCall:${person}`);
      inviteToCall(person);
    },
    removeFromCall(person) {
      calls.push(`removeFromCall:${person}`);
      removeGuest(person);
    },
    unassignStands(stayIds) {
      calls.push(`unassignStands:${stayIds.join("|")}`);
      unassignStays(stayIds);
      selection = { occupancyIds: [], flightId: null };
      revision += 1;
    },
    setAcknowledged(alertId, value) {
      calls.push(`setAcknowledged:${alertId}:${value}`);
      acknowledged = new Set(acknowledged);
      if (value) acknowledged.add(alertId);
      else acknowledged.delete(alertId);
      revision += 1;
    },
  };
}

/* -------------------------------------------------------------- WebRTC */

export type FakeTrack = {
  kind: string;
  enabled: boolean;
  stopped: number;
  stop: () => void;
};

export function createFakeTrack(kind = "audio"): FakeTrack {
  const track: FakeTrack = {
    kind,
    enabled: true,
    stopped: 0,
    stop() {
      track.stopped += 1;
    },
  };
  return track;
}

export type FakeStream = {
  tracks: FakeTrack[];
  getTracks: () => FakeTrack[];
  getAudioTracks: () => FakeTrack[];
};

export function createFakeStream(tracks = [createFakeTrack()]): FakeStream {
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
  };
}

export type FakeChannel = {
  label: string;
  readyState: "connecting" | "open" | "closing" | "closed";
  sent: Record<string, unknown>[];
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
  /** Delivers a JSON event as if it came from the session. */
  deliver: (event: Record<string, unknown>) => void;
};

export type FakePeerConnection = {
  channels: FakeChannel[];
  addedTracks: FakeTrack[];
  closed: number;
  connectionState: string;
  iceGatheringState: "new" | "gathering" | "complete";
  localDescription: { type: string; sdp: string } | null;
  remoteDescription: { type: string; sdp: string } | null;
  ontrack: ((event: { streams: FakeStream[]; track: FakeTrack }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  createDataChannel: (label: string) => FakeChannel;
  addTrack: (track: FakeTrack, stream: FakeStream) => void;
  createOffer: () => Promise<{ type: string; sdp: string }>;
  setLocalDescription: (description: { type: string; sdp: string }) => Promise<void>;
  setRemoteDescription: (description: { type: string; sdp: string }) => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  close: () => void;
  /** Completes ICE gathering and notifies listeners. */
  finishIce: () => void;
  /** Drives the connection-state handler. */
  setConnectionState: (state: string) => void;
};

export type FakePeerOptions = {
  /** Starts already complete, so connect does not wait for ICE. */
  iceComplete?: boolean;
  /** Runs while setRemoteDescription is in flight, e.g. to deliver an event. */
  onSetRemoteDescription?: (peer: FakePeerConnection) => void;
  offerSdp?: string;
};

export function createFakePeerConnection(options: FakePeerOptions = {}): FakePeerConnection {
  const listeners = new Map<string, Set<() => void>>();
  const peer: FakePeerConnection = {
    channels: [],
    addedTracks: [],
    closed: 0,
    connectionState: "new",
    iceGatheringState: options.iceComplete === false ? "new" : "complete",
    localDescription: null,
    remoteDescription: null,
    ontrack: null,
    onconnectionstatechange: null,
    createDataChannel(label) {
      const channel: FakeChannel = {
        label,
        readyState: "open",
        sent: [],
        onmessage: null,
        onclose: null,
        send(data) {
          channel.sent.push(JSON.parse(data));
        },
        close() {
          channel.readyState = "closed";
        },
        deliver(event) {
          channel.onmessage?.({ data: JSON.stringify(event) });
        },
      };
      peer.channels.push(channel);
      return channel;
    },
    addTrack(track) {
      peer.addedTracks.push(track);
    },
    createOffer: () => Promise.resolve({ type: "offer", sdp: options.offerSdp ?? FAKE_OFFER_SDP }),
    setLocalDescription(description) {
      peer.localDescription = description;
      return Promise.resolve();
    },
    setRemoteDescription(description) {
      peer.remoteDescription = description;
      // Mirrors the real race: the channel can open and deliver
      // `session.started` while this promise is still settling.
      options.onSetRemoteDescription?.(peer);
      return Promise.resolve();
    },
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    close() {
      peer.closed += 1;
    },
    finishIce() {
      peer.iceGatheringState = "complete";
      for (const listener of listeners.get("icegatheringstatechange") ?? []) listener();
    },
    setConnectionState(state) {
      peer.connectionState = state;
      peer.onconnectionstatechange?.();
    },
  };
  return peer;
}

/** The only data channel Mica creates. */
export const eventsChannel = (peer: FakePeerConnection): FakeChannel => {
  const channel = peer.channels.find((entry) => entry.label === "oai-events");
  if (!channel) throw new Error("oai-events channel was never created");
  return channel;
};

export const FAKE_OFFER_SDP = ["v=0", "o=- 0 0 IN IP4 127.0.0.1", "m=audio 9 UDP/TLS/RTP/SAVPF 111", "m=application 9 UDP/DTLS/SCTP webrtc-datachannel"].join("\r\n");
export const FAKE_ANSWER_SDP = ["v=0", "o=- 0 0 IN IP4 127.0.0.1", "m=audio 9 UDP/TLS/RTP/SAVPF 111"].join("\r\n");
