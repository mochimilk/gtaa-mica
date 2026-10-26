import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson } from './airport-model.mjs';

const ajv = new Ajv({ allErrors: true });
const shapes = Object.fromEntries(['airlines', 'airports'].map(name => [
  name, ajv.compile(readJson(fileURLToPath(new URL(`../data/schemas/${name}.schema.json`, import.meta.url)))),
]));
const routeShape = ajv.compile(readJson(fileURLToPath(new URL('../data/schemas/route-generation.schema.json', import.meta.url))));

export function loadCatalogs() {
  return Object.fromEntries(['airlines', 'airports'].map(name => [
    name, readJson(fileURLToPath(new URL(`../data/${name}.json`, import.meta.url))),
  ]));
}

function routeChoices(airline, host, airports) {
  const hubs = new Set(airline.hub_airports ?? []);
  const homeHost = host.country === airline.country || hubs.has(host.code);
  return [...airports.keys()].sort().flatMap(code => {
    if (code === host.code) return [];
    const airport = airports.get(code);
    const hub = hubs.has(code);
    const homeCountry = airport.country === airline.country;
    if (!hub && !(homeCountry && (homeHost || !hubs.size))) return [];
    return [{ airport_code: code, country: airport.country, weight: hub ? 5 : 1, basis: hub ? 'hub' : 'home-country' }];
  });
}

const carrierWeight = (entry, airline, host) =>
  entry.weight ?? (airline.country === host.country || airline.hub_airports?.includes(host.code) ? 4 : 1);

function requireSamplingKeys(seed, key) {
  if (typeof seed !== 'string' || !seed.trim() || typeof key !== 'string' || !key.trim()) {
    throw new Error('Synthetic route sampling requires nonblank seed and stable leg key strings');
  }
}

export function validateCatalogs(data) {
  const errors = [];
  const warnings = [];
  for (const [name, shape] of Object.entries(shapes)) {
    if (!shape(data?.[name])) {
      for (const error of shape.errors) {
        errors.push(`${name}${error.instancePath}: ${error.message}${error.params.additionalProperty ? ` (${error.params.additionalProperty})` : ''}`);
      }
    }
  }
  if (errors.length) return { errors, warnings };
  const unique = (rows, field, label) => {
    const values = new Map();
    for (const row of rows) {
      if (row[field] === undefined) continue;
      if (values.has(row[field])) errors.push(`${label}: duplicate ${field} ${row[field]}`);
      values.set(row[field], row);
    }
    return values;
  };
  const airports = unique(data.airports.airports, 'code', 'airports');
  const airlines = unique(data.airlines.airlines, 'id', 'airlines');
  unique(data.airlines.airlines, 'iata', 'airlines');
  unique(data.airlines.airlines, 'icao', 'airlines');
  if (!airlines.size) errors.push('airlines: at least one airline is required');
  for (const airline of airlines.values()) {
    const home = [...airports.values()].filter(airport => airport.country === airline.country);
    if (!home.length) errors.push(`airlines/${airline.id}: no airport in home country ${airline.country}`);
    for (const code of airline.hub_airports ?? []) {
      if (!airports.has(code)) errors.push(`airlines/${airline.id}/hub_airports: unknown airport ${code}`);
    }
    if (airline.hub_airports && !home.some(airport => airline.hub_airports.includes(airport.code))) {
      errors.push(`airlines/${airline.id}/hub_airports: include at least one home-country airport`);
    }
    if (!airline.hub_airports && home.length > 1) {
      warnings.push(`airlines/${airline.id}: no hub hints; synthetic routes use all ${home.length} home-country airports equally`);
    }
  }
  for (const host of airports.values()) {
    if (!host.airlines) continue;
    unique(host.airlines, 'airline_id', `airports/${host.code}/airlines`);
    for (const entry of host.airlines) {
      if (!airlines.has(entry.airline_id)) errors.push(`airports/${host.code}/airlines: unknown airline ${entry.airline_id}`);
    }
  }
  if (errors.length) return { errors: errors.sort(), warnings: warnings.sort() };
  for (const host of airports.values()) {
    if (!host.airlines) continue;
    const enabled = host.airlines.filter(entry => carrierWeight(entry, airlines.get(entry.airline_id), host) > 0);
    if (!enabled.length) errors.push(`airports/${host.code}/airlines: at least one positive carrier weight is required`);
    for (const entry of enabled) {
      if (!routeChoices(airlines.get(entry.airline_id), host, airports).length) {
        errors.push(`airports/${host.code}/airlines/${entry.airline_id}: no external route airports after excluding the host`);
      }
    }
  }
  return { errors: errors.sort(), warnings: warnings.sort() };
}

export function deriveRouteProfile(data, hostCode) {
  const { errors, warnings } = validateCatalogs(data);
  if (errors.length) throw new Error(`Invalid route catalogs:\n${errors.join('\n')}`);
  const airports = new Map(data.airports.airports.map(airport => [airport.code, airport]));
  const airlines = new Map(data.airlines.airlines.map(airline => [airline.id, airline]));
  const host = airports.get(hostCode);
  if (!host) throw new Error(`Unknown host airport: ${hostCode}`);
  if (!host.airlines) throw new Error(`Host ${hostCode} has no synthetic airline roster; configure airports/${hostCode}/airlines`);
  const entries = new Map(host.airlines.map(entry => [entry.airline_id, entry]));
  const choices = [...entries.keys()].sort().flatMap(id => {
    const airline = airlines.get(id);
    const weight = carrierWeight(entries.get(id), airline, host);
    if (!weight) return [];
    const routes = routeChoices(airline, host, airports);
    const total = routes.reduce((sum, route) => sum + route.weight, 0);
    return [{
      airline_id: id, weight,
      routes: routes.map(route => ({ ...route, probability: route.weight / total })),
    }];
  });
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  return {
    synthetic: true, host_airport_code: host.code, host_country: host.country, warnings,
    airlines: choices.map(choice => ({ ...choice, probability: choice.weight / total })),
  };
}

function choose(rows, seed, key) {
  const hash = createHash('sha256').update(JSON.stringify([seed, key])).digest('hex');
  const unit = Number.parseInt(hash.slice(0, 13), 16) / 2 ** 52;
  const target = unit * rows.reduce((sum, row) => sum + row.weight, 0);
  let cumulative = 0;
  return rows.find(row => {
    cumulative += row.weight;
    return cumulative > target;
  });
}

export function createRouteSampler(data, hostCode) {
  const profile = deriveRouteProfile(data, hostCode);
  const choices = structuredClone(profile.airlines);
  return {
    profile,
    sample({ seed, key, airline_id } = {}) {
      requireSamplingKeys(seed, key);

      const airline = airline_id === undefined
        ? choose(choices, seed, [key, 'airline'])
        : choices.find(choice => choice.airline_id === airline_id);
      if (!airline) throw new Error(`Airline is not enabled at ${hostCode}: ${airline_id}`);
      const route = choose(airline.routes, seed, [key, 'route', airline.airline_id]);
      return { airline_id: airline.airline_id, airport_code: route.airport_code };
    },
  };
}

export function createDemandRouteSampler(data, host, policy) {
  const { errors, warnings } = validateCatalogs(data);
  if (errors.length) throw new Error(`Invalid route catalogs:\n${errors.join('\n')}`);
  if (!routeShape(policy)) throw new Error(`Invalid route generation policy: ${ajv.errorsText(routeShape.errors)}`);
  const airports = new Map(data.airports.airports.map(airport => [airport.code, airport]));
  const airlines = new Map(data.airlines.airlines.map(airline => [airline.id, airline]));
  if (typeof host.country !== 'string' || ![...airports.values()].some(airport => airport.country === host.country)) {
    throw new Error('Catalog route generation requires a known explicit host airport country');
  }
  const reference = { code: host.code ?? host.id, country: host.country };
  const marketIds = new Set();
  const endpointIds = new Set();
  const markets = policy.markets.map(market => {
    if (marketIds.has(market.id)) throw new Error(`Duplicate route market: ${market.id}`);
    marketIds.add(market.id);
    for (const endpoint of market.airports) {
      const airport = airports.get(endpoint.airport_code);
      if (!airport) throw new Error(`Unknown market airport: ${endpoint.airport_code}`);
      if (airport.country === host.country) throw new Error(`International market airport is in the host country: ${airport.code}`);
      if (endpointIds.has(airport.code)) throw new Error(`Duplicate airport across route markets: ${airport.code}`);
      endpointIds.add(airport.code);
    }
    return { ...market, airports: market.airports.slice().sort((a, b) => a.airport_code.localeCompare(b.airport_code, 'en')) };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const choices = (airlineId, sector, marketId) => {
    const airline = airlines.get(airlineId);
    if (!airline) throw new Error(`Unknown route airline: ${airlineId}`);
    if (!/^[A-Z0-9]{2}$/.test(airline.iata ?? '')) throw new Error(`Route airline requires a two-character IATA flight prefix: ${airlineId}`);
    if (sector === 'domestic') {
      if (marketId !== undefined) throw new Error('Domestic demand cannot specify an international market');
      const routes = routeChoices(airline, reference, airports).filter(route => route.country === host.country);
      if (!routes.length) throw new Error(`No domestic route airports for ${airlineId}`);
      return [{ id: 'domestic', weight: 1, airports: routes }];
    }
    if (sector !== 'international') throw new Error(`Catalog routes do not define sector policy for ${sector}`);
    if (marketId !== undefined && !marketIds.has(marketId)) throw new Error(`Unknown route market: ${marketId}`);
    const foreignChoices = new Set(routeChoices(airline, reference, airports).map(route => route.airport_code));
    const result = markets.filter(market => marketId === undefined || market.id === marketId).flatMap(market => {
      const endpoints = market.airports.filter(endpoint => airline.country === host.country || foreignChoices.has(endpoint.airport_code));
      return endpoints.length ? [{ ...market, airports: endpoints }] : [];
    });
    if (!result.length) throw new Error(`No international route airports for ${airlineId}${marketId ? ` in ${marketId}` : ''}`);
    return result;
  };
  return {
    warnings,
    validateRow: (airlineId, sector, marketId) => { choices(airlineId, sector, marketId); },
    sample({ seed, key, airline_id, sector_id, market_id } = {}) {
      requireSamplingKeys(seed, key);
      const market = choose(choices(airline_id, sector_id, market_id), seed, [key, 'market', airline_id]);
      const endpoint = choose(market.airports, seed, [key, 'endpoint', airline_id, market.id]);
      return { airport_code: endpoint.airport_code, market_id: market.id };
    },
  };
}
