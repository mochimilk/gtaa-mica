import { createStrokeIcon } from "./createStrokeIcon";

/** A plane struck through: a flight with no stand. */
const AIRPLANE_OFF = [
  "M16.328 10.672 19.5 7.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5l-3.172 3.172",
  "m2 2 20 20",
  "M6.594 6.594 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2l-.394-1.794",
];

export const AirplaneOff20Regular = createStrokeIcon("AirplaneOff20Regular", 20, AIRPLANE_OFF);
