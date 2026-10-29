import Ajv from 'ajv';
import { fileURLToPath } from 'node:url';
import { readJson, validateAirport } from './airport-model.mjs';

const schema = readJson(fileURLToPath(new URL('../data/schemas/raw-demand.schema.json', import.meta.url)));
const instantPattern = new RegExp(schema.definitions.instant.pattern);
const ajv = new Ajv({ allErrors: true, strictRequired: false });
export function isUtcInstant(value) {
  if (typeof value !== 'string' || !instantPattern.test(value)) return false;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return false;
  return new Date(instant).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
}
ajv.addFormat('date-time', isUtcInstant);
const shape = ajv.compile(schema);
const defaultDemand = fileURLToPath(new URL('../data/airports/contoso/demand/validation-legs.json', import.meta.url));

export function parseUtcInstant(value) {
  if (!isUtcInstant(value)) throw new Error(`Expected a valid full UTC timestamp with seconds or milliseconds: ${value}`);
  return Date.parse(value);
}

export function formatUtcInstant(value) {
  if (!Number.isSafeInteger(value) || Number.isNaN(new Date(value).getTime())) throw new Error('Derived timestamp exceeds supported range');
  const result = new Date(value).toISOString();
  if (!isUtcInstant(result)) throw new Error('Derived timestamp exceeds supported four-digit UTC year range');
  return result;
}

export function loadDemand(path = defaultDemand) {
  return readJson(path);
}

export function validateDemand(demand, airport) {
  const errors = [];
  const warnings = [];
  if (!shape(demand)) {
    for (const error of shape.errors) {
      errors.push(`demand${error.instancePath}: ${error.message}${error.params.additionalProperty ? ` (${error.params.additionalProperty})` : ''}`);
    }
    return { errors, warnings };
  }
  const configuration = validateAirport(airport);
  errors.push(...configuration.errors.map(error => `airport: ${error}`));
  warnings.push(...configuration.warnings.map(warning => `airport: ${warning}`));
  if (errors.length) return { errors, warnings };
  if (demand.airport_id !== airport.airport.id) errors.push(`demand.airport_id: must equal ${airport.airport.id}`);
  const catalogs = {
    aircraft_id: new Set(airport.aircraft.aircraft.map(item => item.id)),
    operating_airline_id: new Set(airport.airlines.airlines.map(item => item.id)),
    sector_id: new Set(airport.sectors.sectors.map(item => item.id)),
    origin_stand_id: new Set(airport.stands.stands.map(item => item.id)),
    destination_stand_id: new Set(airport.stands.stands.map(item => item.id)),
  };
  const ids = new Set();
  const registrations = new Map();
  for (const leg of demand.legs) {
    const label = `demand/legs/${leg.id}`;
    if (ids.has(leg.id)) errors.push(`${label}: duplicate leg ID`);
    ids.add(leg.id);
    for (const [field, catalog] of Object.entries(catalogs)) {
      if (leg[field] !== undefined && !catalog.has(leg[field])) errors.push(`${label}/${field}: unknown reference ${leg[field]}`);
    }
    if (registrations.has(leg.aircraft_registration) && registrations.get(leg.aircraft_registration) !== leg.aircraft_id) {
      errors.push(`${label}/aircraft_registration: ${leg.aircraft_registration} has conflicting aircraft models`);
    }
    registrations.set(leg.aircraft_registration, leg.aircraft_id);
    if (leg.type === 'arrival' && leg.destination_airport_id !== demand.airport_id) {
      errors.push(`${label}/destination_airport_id: arrival must end at ${demand.airport_id}`);
    }
    if (leg.type === 'departure' && leg.origin_airport_id !== demand.airport_id) {
      errors.push(`${label}/origin_airport_id: departure must start at ${demand.airport_id}`);
    }
    if (leg.type === 'ground-movement') {
      if (leg.origin_stand_id === leg.destination_stand_id) errors.push(`${label}: ground movement must use different origin and destination stands`);
      if (leg.scheduled_off_block !== undefined && leg.scheduled_on_block !== undefined &&
          Date.parse(leg.scheduled_on_block) <= Date.parse(leg.scheduled_off_block)) {
        errors.push(`${label}: scheduled_on_block must be later than scheduled_off_block`);
      }
    }
  }
  return { errors, warnings };
}
