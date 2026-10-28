import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const schema = readJson(resolve(root, 'data', 'schemas', 'stands.schema.json'));
const ajv = new Ajv({ allErrors: true, strictRequired: false });
const standShape = ajv.compile(schema);
const catalogSchema = name => readJson(resolve(root, 'data', 'schemas', `${name}.schema.json`));
const trafficShape = ajv.compile(catalogSchema('traffic-profile'));
const operatingShape = ajv.compile(catalogSchema('operating-policy'));
const id = { type: 'string', pattern: '^\\S+$' };
const ids = { type: 'array', items: id };
const collection = (key, properties, required = []) => ajv.compile({
  type: 'object', required: [key],
  properties: {
    [key]: {
      type: 'array',
      items: { type: 'object', required: ['id', ...required], properties: { id, ...properties } },
    },
  },
});
const shapes = {
  airport: ajv.compile({
    type: 'object', required: ['id', 'datasets'],
    properties: {
      id,
      time_zone: { type: 'string' },
      datasets: {
        type: 'object', required: ['stands', 'gates', 'buildings'],
        properties: { stands: id, gates: id, buildings: id, traffic_profile: id, operating_policy: id, aircraft: id, aircraft_groups: id },
      },
    },
  }),
  stands: standShape,
  gates: collection('gates', {
    building_id: id, level_id: id, stand_ids: ids, coordinates: schema.definitions.coordinates,
  }, ['building_id', 'level_id']),
  buildings: collection('buildings', {
    levels: {
      type: 'array', items: { type: 'object', required: ['id'], properties: { id } },
    },
  }, ['levels']),
  aircraft: collection('aircraft', {}),
  aircraftGroups: collection('aircraft-groups', { 'aircraft-ids': ids }, ['aircraft-ids']),
  sectors: collection('sectors', {}),
  sectorGroups: collection('sector-groups', { sectors: ids }, ['sectors']),
  airlines: ajv.compile(catalogSchema('airlines')),
  airlineGroups: ajv.compile(catalogSchema('airline-groups')),
};

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON ${path}: ${error.message}`, { cause: error });
  }
}

export function loadAirport(manifestPath = resolve(root, 'data', 'airports', 'contoso', 'airport.json')) {
  const airport = readJson(manifestPath);
  if (!shapes.airport(airport)) throw new Error(`Invalid airport manifest ${manifestPath}: ${ajv.errorsText(shapes.airport.errors)}`);
  const local = key => readJson(resolve(dirname(manifestPath), airport.datasets[key]));
  const shared = name => readJson(resolve(root, 'data', `${name}.json`));
  return {
    airport, stands: local('stands'), gates: local('gates'), buildings: local('buildings'),
    aircraft: airport.datasets.aircraft === undefined ? shared('aircraft') : local('aircraft'),
    aircraftGroups: airport.datasets.aircraft_groups === undefined ? shared('aircraft-groups') : local('aircraft_groups'),
    sectors: shared('sectors'), sectorGroups: shared('sector-groups'),
    airlines: shared('airlines'), airlineGroups: shared('airline-groups'),
    trafficProfile: airport.datasets.traffic_profile === undefined ? undefined : local('traffic_profile'),
    operatingPolicy: airport.datasets.operating_policy === undefined ? undefined : local('operating_policy'),
  };
}

export function validateAirport(data) {
  const errors = [];
  const warnings = [];
  for (const [name, validate] of Object.entries(shapes)) {
    if (!validate(data[name])) {
      for (const error of validate.errors) errors.push(`${name}${error.instancePath}: ${error.message}${error.params.additionalProperty ? ` (${error.params.additionalProperty})` : ''}`);
    }
  }
  for (const [name, validate] of [['trafficProfile', trafficShape], ['operatingPolicy', operatingShape]]) {
    if (data[name] !== undefined && !validate(data[name])) {
      for (const error of validate.errors) errors.push(`${name}${error.instancePath}: ${error.message}${error.params.additionalProperty ? ` (${error.params.additionalProperty})` : ''}`);
    }
  }
  if (errors.length) return { errors, warnings };
  const index = (items, label) => {
    const result = new Map();
    for (const item of items) {
      if (result.has(item.id)) errors.push(`${label}: duplicate ID ${item.id}`);
      result.set(item.id, item);
    }
    return result;
  };
  const stands = index(data.stands.stands, 'stands');
  const gates = index(data.gates.gates, 'gates');
  const buildings = index(data.buildings.buildings, 'buildings');
  const aircraft = index(data.aircraft.aircraft, 'aircraft');
  const aircraftGroups = index(data.aircraftGroups['aircraft-groups'], 'aircraftGroups');
  const sectors = index(data.sectors.sectors, 'sectors');
  const sectorGroups = index(data.sectorGroups['sector-groups'], 'sectorGroups');
  const airlines = index(data.airlines.airlines, 'airlines');
  const airlineGroups = index(data.airlineGroups.groups, 'airlineGroups');
  const reference = (value, target, path) => {
    if (!target.has(value)) errors.push(`${path}: unknown reference ${value}`);
  };
  if (data.operatingPolicy !== undefined) {
    const policy = data.operatingPolicy;
    if (policy.airport_id !== data.airport.id) errors.push(`operatingPolicy.airport_id: must equal ${data.airport.id}`);
    if (policy['default-tow-minutes'] !== undefined && !Number.isSafeInteger(policy['default-tow-minutes'] * 60_000)) {
      errors.push('operatingPolicy/default-tow-minutes: duration exceeds supported millisecond precision');
    }
    const codes = new Set();
    for (const rule of policy['minimum-leg-windows']) {
      for (const code of rule['aircraft-size-codes']) {
        if (codes.has(code)) errors.push(`operatingPolicy: aircraft size code ${code} has more than one minimum leg window`);
        codes.add(code);
      }
      for (const direction of ['arrival', 'departure']) {
        if (!Number.isSafeInteger(rule[`${direction}-minutes`] * 60_000)) errors.push(`operatingPolicy/${direction}-minutes: duration exceeds supported millisecond precision`);
      }
    }
    for (const model of aircraft.values()) {
      if (!codes.has(model['ICAO-code'])) errors.push(`aircraft/${model.id}/ICAO-code: missing or unconfigured aircraft size code ${model['ICAO-code']}`);
    }
  }
  const airlineMembership = new Map();
  for (const group of airlineGroups.values()) {
    for (const airline of group.airlines) {
      reference(airline, airlines, `airlineGroups/${group.id}/airlines`);
      if (airlineMembership.has(airline)) errors.push(`airlineGroups: ${airline} belongs to both ${airlineMembership.get(airline)} and ${group.id}; airline groups must not overlap`);
      airlineMembership.set(airline, group.id);
    }
    if (!group.airlines.length) warnings.push(`airlineGroups/${group.id}: empty group authorizes no airlines`);
  }
  if (data.trafficProfile !== undefined) {
    const profile = data.trafficProfile;
    if (profile.airport_id !== data.airport.id) errors.push(`trafficProfile.airport_id: must equal ${data.airport.id}`);
    if (typeof data.airport.time_zone !== 'string' || !data.airport.time_zone.trim()) {
      errors.push('airport.time_zone: required for an airport-local traffic profile');
    } else {
      try {
        new Intl.DateTimeFormat('en', { timeZone: data.airport.time_zone });
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        errors.push(`airport.time_zone: unsupported time zone ${data.airport.time_zone}`);
      }
    }
    const seen = new Set();
    for (const pattern of profile['sector-patterns']) {
      reference(pattern.sector, sectors, 'trafficProfile/sector-patterns/sector');
      if (seen.has(pattern.sector)) errors.push(`trafficProfile: duplicate sector ${pattern.sector}`);
      seen.add(pattern.sector);
      for (const direction of ['arrival', 'departure']) {
        const total = pattern[`${direction}-hourly-weights`].reduce((sum, value) => sum + value, 0);
        if (!Number.isFinite(total) || total <= 0) errors.push(`trafficProfile/${pattern.sector}/${direction}: weights must have a finite positive total`);
      }
    }
  }
  for (const [name, target] of [['stands', data.stands], ['gates', data.gates], ['buildings', data.buildings]]) {
    if (target.airport_id !== data.airport.id) errors.push(`${name}.airport_id: must equal ${data.airport.id}`);
  }
  for (const [groups, field, members, label] of [
    [aircraftGroups, 'aircraft-ids', aircraft, 'aircraftGroups'],
    [sectorGroups, 'sectors', sectors, 'sectorGroups'],
  ]) {
    for (const group of groups.values()) {
      for (const member of group[field]) reference(member, members, `${label}/${group.id}/${field}`);
      if (new Set(group[field]).size !== group[field].length) warnings.push(`${label}/${group.id}: duplicate members are deduplicated in memory`);
      if (!group[field].length) warnings.push(`${label}/${group.id}: empty group matches nothing`);
    }
  }
  for (const building of buildings.values()) index(building.levels, `buildings/${building.id}/levels`);
  const gatesToStands = new Map([...gates.keys()].map(key => [key, []]));
  for (const gate of gates.values()) {
    reference(gate.building_id, buildings, `gates/${gate.id}/building_id`);
    if (buildings.has(gate.building_id) && !buildings.get(gate.building_id).levels.some(level => level.id === gate.level_id)) {
      errors.push(`gates/${gate.id}/level_id: unknown level ${gate.level_id} in ${gate.building_id}`);
    }
  }
  const checkDimensions = (object, path, plural = false) => {
    for (const group of object['aircraft-groups'] ?? []) reference(group, aircraftGroups, `${path}/aircraft-groups`);
    for (const leg of ['arrival', 'departure']) {
      const key = `${leg}-sector-group${plural ? 's' : ''}`;
      const values = plural ? object[key] ?? [] : object[key] == null ? [] : [object[key]];
      for (const group of values) reference(group, sectorGroups, `${path}/${key}`);
    }
  };
  for (const stand of stands.values()) {
    const path = `stands/${stand.id}`;
    if (stand.associated_building_id) reference(stand.associated_building_id, buildings, `${path}/associated_building_id`);
    for (const gate of stand.gate_ids ?? []) {
      reference(gate, gates, `${path}/gate_ids`);
      if (gatesToStands.has(gate)) gatesToStands.get(gate).push(stand.id);
    }
    checkDimensions(stand, path);
    for (const leg of ['arrival', 'departure']) {
      for (const group of stand[`${leg}-aircraft-groups`] ?? []) reference(group, aircraftGroups, `${path}/${leg}-aircraft-groups`);
    }
    for (const group of stand['airline-groups'] ?? []) reference(group, airlineGroups, `${path}/airline-groups`);
    for (const kind of ['close-conditions', 'restriction-conditions']) {
      for (const [position, condition] of (stand[kind] ?? []).entries()) {
        const location = `${path}/${kind}/${position}`;
        reference(condition.stand, stands, `${location}/stand`);
        if (condition.stand === stand.id) errors.push(`${location}: a condition cannot reference its own stand`);
        checkDimensions(condition, location);
        if (condition.allow) checkDimensions(condition.allow, `${location}/allow`, true);
      }
    }
    if (stand.configuration_status !== 'ready') warnings.push(`${path}: geometry-only; not eligible for rule evaluation`);
  }
  for (const gate of gates.values()) {
    if (gate.stand_ids !== undefined) {
      const derived = gatesToStands.get(gate.id);
      if (new Set(gate.stand_ids).size !== gate.stand_ids.length || gate.stand_ids.length !== derived.length || gate.stand_ids.some(value => !derived.includes(value))) {
        warnings.push(`gates/${gate.id}/stand_ids: legacy inverse differs from stands.gate_ids; use the derived inverse`);
      }
    }
  }
  if (data.airport.planning_ready === true && [...stands.values()].some(stand => stand.configuration_status !== 'ready')) {
    errors.push('airport.planning_ready: geometry-only stands remain');
  }
  return { errors, warnings };
}

export function compileAirport(data) {
  const validation = validateAirport(data);
  if (validation.errors.length) throw new Error(`Invalid airport configuration:\n${validation.errors.join('\n')}`);
  const stands = new Map(data.stands.stands.map(stand => [stand.id, stand]));
  const gatesToStands = new Map(data.gates.gates.map(gate => [gate.id, []]));
  const conditionsByStand = new Map([...stands.keys()].map(key => [key, []]));
  for (const stand of stands.values()) {
    for (const gate of stand.gate_ids ?? []) gatesToStands.get(gate).push(stand.id);
    for (const kind of ['close-conditions', 'restriction-conditions']) {
      for (const [position, condition] of (stand[kind] ?? []).entries()) {
        const rule = { targetStandId: stand.id, kind, condition, path: `stands/${stand.id}/${kind}/${position}` };
        conditionsByStand.get(stand.id).push(rule);
        conditionsByStand.get(condition.stand).push(rule);
      }
    }
  }
  const members = (items, field) => new Map(items.map(item => [item.id, new Set(item[field])]));
  const airlineGroups = members(data.airlineGroups.groups, 'airlines');
  const allowedAirlines = new Map([...stands.values()].map(stand => [
    stand.id, new Set((stand['airline-groups'] ?? []).flatMap(group => [...airlineGroups.get(group)])),
  ]));
  return {
    stands, gatesToStands, conditionsByStand, warnings: validation.warnings,
    airlineGroups, allowedAirlines,
    airlines: new Set(data.airlines.airlines.map(item => item.id)),
    timeZone: data.airport.time_zone,
    trafficPatterns: new Map((data.trafficProfile?.['sector-patterns'] ?? []).map(pattern => [pattern.sector, pattern])),
    aircraftSizeCodes: new Map(data.aircraft.aircraft.map(item => [item.id, item['ICAO-code']])),
    minimumLegWindows: new Map((data.operatingPolicy?.['minimum-leg-windows'] ?? []).flatMap(rule =>
      rule['aircraft-size-codes'].map(code => [code, rule]))),
    defaultTowMinutes: data.operatingPolicy?.['default-tow-minutes'],
    aircraft: new Set(data.aircraft.aircraft.map(item => item.id)),
    sectors: new Set(data.sectors.sectors.map(item => item.id)),
    aircraftGroups: members(data.aircraftGroups['aircraft-groups'], 'aircraft-ids'),
    sectorGroups: members(data.sectorGroups['sector-groups'], 'sectors'),
  };
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const belongs = (value, groups, catalog) => groups.some(group => catalog.get(group).has(value));

function matches(model, condition, occupancy) {
  if (condition['aircraft-groups'] != null && !belongs(occupancy.aircraftId, condition['aircraft-groups'], model.aircraftGroups)) return false;
  return ['arrival', 'departure'].every(leg => {
    const group = condition[`${leg}-sector-group`];
    return group == null || (occupancy[leg] != null && model.sectorGroups.get(group).has(occupancy[leg].sectorId));
  });
}

export function evaluatePlan(model, occupancies) {
  const byStand = new Map([...model.stands.keys()].map(key => [key, []]));
  const ids = new Set();
  for (const occupancy of occupancies) {
    if (typeof occupancy.id !== 'string' || !/^\S+$/.test(occupancy.id) || ids.has(occupancy.id)) throw new Error(`Invalid or duplicate occupancy ID: ${occupancy.id}`);
    ids.add(occupancy.id);
    if (!model.stands.has(occupancy.standId)) throw new Error(`Unknown occupancy stand: ${occupancy.standId}`);
    if (model.stands.get(occupancy.standId).configuration_status !== 'ready') throw new Error(`Stand is not configured: ${occupancy.standId}`);
    if (!model.aircraft.has(occupancy.aircraftId)) throw new Error(`Unknown occupancy aircraft: ${occupancy.aircraftId}`);
    if (!Number.isFinite(occupancy.start) || !Number.isFinite(occupancy.end) || occupancy.end <= occupancy.start) throw new Error(`Invalid occupancy window: ${occupancy.id}`);
    if (occupancy.operatingAirlineIds !== undefined &&
        (!Array.isArray(occupancy.operatingAirlineIds) || !occupancy.operatingAirlineIds.length ||
         occupancy.operatingAirlineIds.some(id => !model.airlines.has(id)))) {
      throw new Error(`Missing or unknown occupancy operating airline: ${occupancy.id}`);
    }
    for (const leg of ['arrival', 'departure']) {
      if (occupancy[leg] !== undefined && (!occupancy[leg] || !model.sectors.has(occupancy[leg].sectorId))) throw new Error(`Missing or unknown ${leg} sector: ${occupancy.id}`);
      if (occupancy[leg] !== undefined && !model.airlines.has(occupancy[leg].operatingAirlineId)) throw new Error(`Missing or unknown ${leg} operating airline: ${occupancy.id}`);
    }
    byStand.get(occupancy.standId).push(occupancy);
  }
  const findings = [];
  for (const items of byStand.values()) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (overlaps(items[i], items[j])) findings.push({ code: 'stand-overlap', standId: items[i].standId, assignmentIds: [items[i].id, items[j].id] });
      }
    }
  }
  for (const occupancy of occupancies) {
    const stand = model.stands.get(occupancy.standId);
    const report = (code, extra = {}) => findings.push({ code, standId: stand.id, assignmentIds: [occupancy.id], ...extra });
    if (stand.closed || !model.allowedAirlines.get(stand.id).size) {
      report('stand-closed', { reason: stand.closed ? 'configured-closure' : 'no-authorized-airlines' });
      continue;
    }
    if (!belongs(occupancy.aircraftId, stand['aircraft-groups'], model.aircraftGroups)) report('aircraft-not-allowed');
    if (occupancy.operatingAirlineIds?.some(id => !model.allowedAirlines.get(stand.id).has(id))) report('occupancy-airline-not-allowed');
    for (const leg of ['arrival', 'departure']) {
      if (occupancy[leg] && stand[`${leg}-aircraft-groups`] !== undefined &&
          !belongs(occupancy.aircraftId, stand[`${leg}-aircraft-groups`], model.aircraftGroups)) report(`${leg}-aircraft-not-allowed`);
      if (occupancy[leg] && !model.sectorGroups.get(stand[`${leg}-sector-group`]).has(occupancy[leg].sectorId)) report(`${leg}-sector-not-allowed`);
      if (occupancy[leg] && !model.allowedAirlines.get(stand.id).has(occupancy[leg].operatingAirlineId)) report(`${leg}-airline-not-allowed`);
    }
    const active = model.conditionsByStand.get(stand.id)
      .filter(rule => rule.targetStandId === stand.id)
      .map(rule => ({
        ...rule,
        triggers: byStand.get(rule.condition.stand).filter(trigger => overlaps(occupancy, trigger) && matches(model, rule.condition, trigger)),
      }))
      .filter(rule => rule.triggers.length);
    const closures = active.filter(rule => rule.kind === 'close-conditions');
    for (const rule of closures) report('conditional-closure', {
      rulePath: rule.path, category: rule.condition.category, description: rule.condition.description,
      triggerAssignmentIds: rule.triggers.map(item => item.id),
    });
    if (closures.length) continue;
    for (const rule of active) {
      const allow = rule.condition.allow;
      const denied = [];
      if (allow['aircraft-groups'] !== undefined && !belongs(occupancy.aircraftId, allow['aircraft-groups'], model.aircraftGroups)) denied.push('aircraft');
      if (allow['maximum-aircraft-size-code'] !== undefined) {
        const code = model.aircraftSizeCodes.get(occupancy.aircraftId);
        if (typeof code !== 'string' || !/^[A-F]$/.test(code)) denied.push('aircraft-size-unverified');
        else if (code > allow['maximum-aircraft-size-code']) denied.push('aircraft-size');
      }
      for (const leg of ['arrival', 'departure']) {
        const groups = allow[`${leg}-sector-groups`];
        if (occupancy[leg] && groups !== undefined && !belongs(occupancy[leg].sectorId, groups, model.sectorGroups)) denied.push(leg);
      }
      if (denied.length) report('conditional-restriction', {
        rulePath: rule.path, category: rule.condition.category, description: rule.condition.description,
        triggerAssignmentIds: rule.triggers.map(item => item.id), denied,
      });
    }
  }
  return findings;
}

export function getHourlyDistribution(model, sectorId, direction) {
  if (direction !== 'arrival' && direction !== 'departure') throw new Error(`Unknown traffic direction: ${direction}`);
  const pattern = model.trafficPatterns.get(sectorId);
  if (!pattern) throw new Error(`No traffic pattern configured for sector: ${sectorId}`);
  const weights = pattern[`${direction}-hourly-weights`];
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map(value => value / total);
}

export function trafficWeightAt(model, sectorId, direction, instant) {
  if (!Number.isFinite(instant) || Number.isNaN(new Date(instant).getTime())) throw new Error('Traffic lookup requires a valid UTC epoch-millisecond instant');
  const distribution = getHourlyDistribution(model, sectorId, direction);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: model.timeZone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const hour = Number(parts.find(part => part.type === 'hour').value);
  return distribution[hour];
}

export function getMinimumLegWindow(model, aircraftId, direction, blockTime) {
  if (direction !== 'arrival' && direction !== 'departure') throw new Error(`Unknown leg direction: ${direction}`);
  if (!Number.isFinite(blockTime) || Number.isNaN(new Date(blockTime).getTime())) throw new Error('Leg window requires a valid UTC epoch-millisecond block time');
  if (!model.aircraft.has(aircraftId)) throw new Error(`Unknown aircraft: ${aircraftId}`);
  const aircraftSizeCode = model.aircraftSizeCodes.get(aircraftId);
  const rule = model.minimumLegWindows.get(aircraftSizeCode);
  if (!rule) throw new Error(`Minimum leg window policy is not configured for aircraft ${aircraftId} (size ${aircraftSizeCode})`);
  const minimumMinutes = rule[`${direction}-minutes`];
  const duration = minimumMinutes * 60_000;
  const start = direction === 'arrival' ? blockTime : blockTime - duration;
  const end = direction === 'arrival' ? blockTime + duration : blockTime;
  if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) throw new Error('Derived leg window exceeds supported timestamp range');
  return { start, end, minimumMinutes, aircraftSizeCode };
}
