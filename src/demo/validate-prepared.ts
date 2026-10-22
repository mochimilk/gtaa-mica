import validate from "./prepared-validator.mjs";
import type { PreparedScenario } from "./dataset";

export function validatePreparedSnapshot(value: unknown): PreparedScenario {
  if (!validate(value)) {
    throw new Error(`Prepared demo data is invalid: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  }
  const times = [
    value.plan_window.start, value.plan_window.end, ...value.flights.map(flight => flight.scheduled),
    ...Object.values(value.variants).flatMap(plan => plan.stays.flatMap(stay => [stay.start, stay.end])),
  ];
  for (const time of times) {
    const parsed = Date.parse(time);
    const canonical = time.includes(".") ? time : time.replace("Z", ".000Z");
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== canonical) {
      throw new Error(`Prepared demo date is invalid: ${time}`);
    }
  }
  return value;
}
