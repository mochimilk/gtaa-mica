// Aircraft makers' emblems, shown with an aircraft type between the ends of
// its flight card (../operations/FlightCard). Each file is white, so it is
// drawn as a mask in the text colour around it, in either mode (.demo-emblem
// in ./demo.css).
import airbusEmblem from "../assets/emblems/airbus.svg";
import boeingEmblem from "../assets/emblems/boeing.svg";
import embraerEmblem from "../assets/emblems/embraer.svg";
import { AIRCRAFT_MAKER } from "./syntheticFixture";

export interface Emblem {
  src: string;
  /** Drawn 20px wide at the file's own height, px. */
  height: number;
}

const MAKER_EMBLEM: Readonly<Record<string, Emblem>> = {
  Airbus: { src: airbusEmblem, height: 20 },
  Boeing: { src: boeingEmblem, height: 16.4693 },
  Embraer: { src: embraerEmblem, height: 20 },
};

/** The emblem of an aircraft type's maker; undefined for a type or maker without one. */
export function emblemOf(type: string | undefined): Emblem | undefined {
  const maker = type ? AIRCRAFT_MAKER[type] : undefined;
  return maker ? MAKER_EMBLEM[maker] : undefined;
}

/** The emblem in a 20px square, in the current text colour. Decorative: the type it goes with names the aircraft. */
export function MakerEmblem({ emblem, className }: { emblem: Emblem; className?: string }) {
  return (
    <span className={className ? `demo-emblem ${className}` : "demo-emblem"} aria-hidden="true">
      <span style={{ height: emblem.height, maskImage: `url("${emblem.src}")` }} />
    </span>
  );
}
