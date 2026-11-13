import { DefaultBar, OccupancyBars, StandRows, StandTimeline, TimeAxis, TimeGrid, HOUR, MINUTE } from "../stand-timeline";
import { useDrawings } from "../studio/drawings";
import { PixelArt, crispSize } from "../studio/PixelArt";
import { fluentChartTheme } from "../stand-timeline-demo/theme";
import { buildRequestDecision, utcDate, utcTime, type RequestTurn } from "./requestDecision";

export function TurnCard({ turn, label }: { turn: RequestTurn; label: string }) {
  const drawings = useDrawings();
  const pixels = turn.aircraftType ? drawings.get(turn.aircraftType) : undefined;
  return <section className="request-turn" aria-label={label} data-request-turn="">
    <div className="request-turn-end">
      <small>Arrival</small>
      <strong>{turn.arrival.label}</strong>
      <span>{turn.arrival.route}</span>
      <time dateTime={new Date(turn.start).toISOString()}>{utcTime(turn.start)} <small>UTC</small></time>
      <span>{utcDate(turn.start)}</span>
    </div>
    <div className="request-turn-middle">
      {pixels && <PixelArt pixels={pixels} size={crispSize(24)} />}
      <strong>{turn.minutes} min</strong>
      <span>{turn.aircraftType ?? "Aircraft not specified"}</span>
      <small>Turn duration</small>
    </div>
    <div className="request-turn-end request-turn-end--departure">
      <small>Departure</small>
      <strong>{turn.departure.label}</strong>
      <span>{turn.departure.route}</span>
      <time dateTime={new Date(turn.end).toISOString()}>{utcTime(turn.end)} <small>UTC</small></time>
      <span>{utcDate(turn.end)}</span>
    </div>
  </section>;
}

type Decision = ReturnType<typeof buildRequestDecision>;
const pair = (turn: RequestTurn) => `${turn.arrival.label} / ${turn.departure.label}`;
const timing = (turn: RequestTurn) => `${utcDate(turn.start)} ${utcTime(turn.start)} to ${utcDate(turn.end)} ${utcTime(turn.end)} UTC`;

export function RequestOption({ decision, threshold }: { decision: Decision; threshold?: number }) {
  const { chart, incoming, moves, neighbors } = decision;
  const gap = (minutes: number | null, neighbor: RequestTurn | null, side: "before" | "after") => <div>
    {minutes === null ? <span>No {side === "before" ? "earlier" : "later"} turn in supplied schedule</span> : <>
      <strong className={threshold !== undefined && minutes < threshold ? "request-gap--tight" : ""}>
        {minutes} min{threshold !== undefined && minutes < threshold ? " · tight" : ""}
      </strong>
      {neighbor && <small>{side === "before" ? "After" : "Before"} {pair(neighbor)}<br />
        {utcDate(side === "before" ? neighbor.end : neighbor.start)} {utcTime(side === "before" ? neighbor.end : neighbor.start)} UTC</small>}
    </>}
  </div>;
  return <section data-request-option="" aria-label="Selected option">
    <h3>Proposed changes</h3>
    <ol className="request-actions">
      {moves.map(move => <li key={move.before.id}>
        <strong>Reassign {pair(move.after)}: {move.before.stand} → {move.after.stand}</strong>
        <p>Free stand {move.before.stand} for the incoming turn. {move.contact ? "Contact" : "Non-contact"} destination;
          compatibility checked. Arrive directly at {move.after.stand}; no added tow.</p>
        <TurnCard turn={move.after} label="Turn to reassign" />
      </li>)}
      <li><strong>Assign {pair(incoming)} to {incoming.stand}</strong>
        <p>{timing(incoming)} · {incoming.minutes} min.
          {moves.length ? " Uses the stand released by the reassignment." : " Direct fit; no existing turn moves."}</p>
      </li>
    </ol>
    <h3>Stand context</h3>
    <p className="request-note">Original reference versus selected option, on the same time scale.
      Includes at least one hour before and after the affected turns.
      Times are UTC; bars at the edges may continue outside the view.</p>
    <div className="request-legend" aria-label="Timeline legend">
      <span className="request-legend--incoming">Incoming turn</span>
      <span className="request-legend--reassigned">Reassigned turn</span>
      <span className="request-legend--released">Leaves this stand</span>
      <span>Other scheduled turns</span>
    </div>
    <StandTimeline rows={chart.rows} occupancies={chart.occupancies} domain={chart.domain}
      timeZone="UTC" rowHeight={64} labelWidth={130} axisHeight={36} axes="top"
      minHourWidth={115} barInset={8} maxHeight={340} className="request-context" style={fluentChartTheme}
      ariaLabel="Original reference and proposed stand assignments on a shared UTC timeline">
      <StandRows />
      <TimeGrid majorMs={HOUR} minorMs={30 * MINUTE} />
      <TimeAxis stepMs={30 * MINUTE} majorMs={HOUR} format={time =>
        utcTime(time) === "00:00" ? `${utcDate(time)} 00:00` : utcTime(time)} />
      <OccupancyBars barStyle={bar => ({ className: `request-bar--${chart.bars.get(bar.occupancy.id)!.kind}` })}
        describe={bar => {
          const item = chart.bars.get(bar.occupancy.id)!;
          return `${item.phase}: stand ${item.turn.stand}, ${pair(item.turn)}, ${item.turn.arrival.route} to ${item.turn.departure.route}, ${timing(item.turn)}; ${item.kind}`;
        }}
        renderBar={(bar, style) => {
          const item = chart.bars.get(bar.occupancy.id)!, capacity = Math.max(0, Math.floor((bar.width - 14) / 7));
          const name = pair(item.turn);
          const label = name.length <= capacity ? name : capacity > 5 ? `${name.slice(0, capacity - 3)}...` : "";
          return <g>
            <title>{pair(item.turn)} · {item.turn.arrival.route} → {item.turn.departure.route} · {timing(item.turn)}</title>
            <DefaultBar bar={bar} style={style} />
            {label && <text x={bar.x + 7} y={bar.y + 19} className="request-context-label">{label}</text>}
            {capacity >= 13 && <text x={bar.x + 7} y={bar.y + 36} className="request-context-time">
              {utcTime(item.turn.start)}–{utcTime(item.turn.end)}
            </text>}
          </g>;
        }} />
    </StandTimeline>
    <table className="timeline-overlay-evidence request-gaps" data-request-gaps="">
      <caption>Scheduled gaps with this option applied{threshold === undefined ? "" : `; tight means below ${threshold} min`}.
        These are not minimum operational separation rules.</caption>
      <thead><tr><th>Turn / stand</th><th>Gap before</th><th>Gap after</th></tr></thead>
      <tbody>{neighbors.map(item => <tr key={item.turn.id}>
        <th>{pair(item.turn)}<br />Stand {item.turn.stand}</th>
        <td>{gap(item.beforeMinutes, item.previous, "before")}</td>
        <td>{gap(item.afterMinutes, item.next, "after")}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
