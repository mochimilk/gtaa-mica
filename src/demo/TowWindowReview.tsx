import { useId } from "react";
import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Select, tokens,
} from "@fluentui/react-components";
import { useTimeline, useTimelineRegion } from "../stand-timeline";
import type { PreparedTowWindows, TowAssessment, TowWindowSegment } from "./tow-windows-evaluation";

const time = (value: number) => new Date(value).toISOString();
const description = (segment: TowWindowSegment) =>
  `${segment.assessment.visit.arrFlight}/${segment.assessment.visit.depFlight}: one-way tow starts ${time(segment.earliest)} to ${time(segment.latest)}, destination checked`;

export function TowWindowOverlay({ segments, onInspect, isMatch }: {
  segments: TowWindowSegment[]; onInspect: (id: string) => void; isMatch?: (stayId: string) => boolean;
}) {
  const patternId = useId();
  const region = useTimelineRegion(), { bars, scale } = useTimeline();
  if (region !== "plot") return null;
  return <g aria-label="Destination-checked one-way tow windows">
    <defs>
      <pattern id={patternId} width={6} height={6} patternUnits="userSpaceOnUse">
        <path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke={tokens.colorPaletteMarigoldForeground2} strokeOpacity={0.65} />
      </pattern>
    </defs>
    {segments.map(segment => {
      const bar = bars.find(bar => bar.occupancy.id === segment.assessment.stayId);
      if (!bar) return null;
      const x = scale.x(segment.earliest), right = scale.x(segment.latest);
      const width = Math.max(1, right - x), hitWidth = Math.max(6, width);
      const y = bar.y + 2, height = Math.max(1, bar.height - 4);
      return <g key={segment.id} className="st-bar" role="button" tabIndex={0}
        data-tow-window-id={segment.id} data-source-stay-id={segment.assessment.stayId}
        aria-label={`Inspect ${description(segment)}`} data-ops-keep-selection=""
        opacity={isMatch && segment.assessment.stayId && !isMatch(segment.assessment.stayId) ? 0.3 : 1}
        onClick={event => { event.stopPropagation(); onInspect(segment.assessment.id); }}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault(); event.stopPropagation(); onInspect(segment.assessment.id);
          }
        }}>
        <title>{description(segment)}</title>
        <rect x={x} y={y} width={width} height={height} fill={tokens.colorPaletteMarigoldForeground2} fillOpacity={0.18} />
        <rect data-tow-window-band="" x={x} y={y} width={width} height={height} fill={`url(#${patternId})`}
          stroke={tokens.colorPaletteMarigoldForeground2} strokeWidth={1} strokeDasharray="2 3" />
        <rect x={x - (hitWidth - width) / 2} y={y} width={hitWidth} height={height} fill="transparent" />
        <rect className="st-bar-outline" x={x - 1} y={y - 1} width={width + 2} height={height + 2} />
      </g>;
    })}
  </g>;
}

export function TowWindowReview({ evidence, assessments, selectedId, setSelectedId, open, setOpen, show, setShow }: {
  evidence: PreparedTowWindows; assessments: TowAssessment[]; selectedId: string; setSelectedId: (id: string) => void;
  open: boolean; setOpen: (open: boolean) => void; show: boolean; setShow: (show: boolean) => void;
}) {
  const labelId = useId();
  const selected = assessments.find(item => item.id === selectedId);
  const departureEnd = selected?.stayEnd;
  if (selectedId && !selected) throw new Error("Unknown tow-window inspection.");
  return <>
    <Button id="tow-window-trigger" data-ops-keep-selection="" appearance={show ? "primary" : "secondary"}
      onClick={() => setOpen(true)}>Tow windows</Button>
    <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}
      surfaceMotion={{ onMotionFinish: () => { if (!open) document.getElementById("tow-window-trigger")?.focus({ preventScroll: true }); } }}>
      <DialogSurface><DialogBody>
        <DialogTitle>One-way tow opportunities</DialogTitle>
        <DialogContent>
          <p>One movement from the current stand to a compatible, available departure stand.
            Gold hatched sections inside lozenges show possible tow-start times, not scheduled movements or added capacity.</p>
          <Checkbox checked={show} label="Show destination-checked tow windows" onChange={(_, data) => setShow(data.checked === true)} />
          <p>Each start range has at least one destination available from tow arrival through departure.
            Aircraft, airline, sector and bidirectional adjacency rules are checked against the unchanged rest of the plan.
            Ranges are inclusive instants, clipped to the display horizon; exact fits remain visible.</p>
          <p>{assessments.filter(item => item.available).length} of {assessments.length} visits have a destination-checked one-way tow window on this plan.
            Unassigned visits and existing movement chains are not offered as new tow windows. Known context times are retained;
            unknown arrival/departure boundaries are never invented or extended to horizon edges.</p>
          <Field label={{ children: "Visit assessment", htmlFor: labelId }}>
            <Select id={labelId} value={selectedId} onChange={event => {
              if (!assessments.some(item => item.id === event.target.value)) throw new Error("Unknown tow-window visit.");
              setSelectedId(event.target.value);
            }}>
              <option value="" disabled>Select a visit or click a gold band</option>
              {assessments.map(item => <option key={item.id} value={item.id}>{item.visit.arrFlight}/{item.visit.depFlight} ({item.available ? "window" : "not offered"})</option>)}
            </Select>
          </Field>
          {selected && <>
            <h3>{selected.visit.arrFlight}/{selected.visit.depFlight}</h3>
            <p>{selected.status}.</p>
            <p>Arrival handling: {selected.policy.arrival_handling_minutes} min. Departure handling: {selected.policy.departure_handling_minutes} min.</p>
            {selected.available && departureEnd !== null && departureEnd !== undefined && <><h4>Available destinations</h4><ul>
              {selected.destinations.map(destination => <li key={destination.stand_id}>
                <p>Stand {destination.label}: tow may start {time(destination.earliest_start)} to {time(destination.latest_start)}.</p>
                <p>Destination occupied from tow arrival ({evidence.default_tow_minutes} min after the selected start)
                  through departure at {time(departureEnd)}.</p>
                <p>Current stand released for {Number(((departureEnd - destination.latest_start) / 60_000).toFixed(2))}
                  {" "}to {Number(((departureEnd - destination.earliest_start) / 60_000).toFixed(2))} minutes of the original stay.</p>
              </li>)}
            </ul></>}
          </>}
          <p>Configured travel: {evidence.default_tow_minutes} min. Earliest start is arrival plus arrival handling.
            Latest start is departure minus departure handling and one tow travel time.
            Destination conflicts can shorten or remove that range; no available destination means no gold band.
            A wider band means more timing flexibility, not more added flights.
            Earlier starts release the current stand for longer.</p>
          <p>Handling minima protect the tow decision; they do not impose a universal sum-of-handling minimum on ordinary complete turns.
            This read-only overlay does not run the solver, apply a relocation or move any flight time.
            It does not assess parking-and-return cycles or adjustments to existing tow chains.
            Tow routes, crews, equipment and shared-gate resources are not certified; a highlight is not operational authorization.</p>
          <p>{evidence.airport.name}; synthetic evidence v{evidence.schema_version}. Snapshot, airport and demand fingerprints verified on load.
            Source assessments are prepared offline; there is no hosted service.</p>
        </DialogContent>
        <DialogActions><Button onClick={() => setOpen(false)}>Close</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </>;
}
