import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const schema = readJson(resolve(root, 'data', 'schemas', 'stands.schema.json'));
const ajv = new Ajv({ allErrors: true, strictRequired: false });
const standShape = ajv.compile(schema);
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
      datasets: {
        type: 'object', required: ['stands', 'gates', 'buildings'],
        properties: { stands: id, gates: id, buildings: id },
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
    aircraft: shared('aircraft'), aircraftGroups: shared('aircraft-groups'),
    sectors: shared('sectors'), sectorGroups: shared('sector-groups'),
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
  const reference = (value, target, path) => {
    if (!target.has(value)) errors.push(`${path}: unknown reference ${value}`);
  };
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
  return {
    stands, gatesToStands, conditionsByStand, warnings: validation.warnings,
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
    for (const leg of ['arrival', 'departure']) {
      if (occupancy[leg] !== undefined && (!occupancy[leg] || !model.sectors.has(occupancy[leg].sectorId))) throw new Error(`Missing or unknown ${leg} sector: ${occupancy.id}`);
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
    if (stand.closed) {
      report('stand-closed');
      continue;
    }
    if (!belongs(occupancy.aircraftId, stand['aircraft-groups'], model.aircraftGroups)) report('aircraft-not-allowed');
    for (const leg of ['arrival', 'departure']) {
      if (occupancy[leg] && !model.sectorGroups.get(stand[`${leg}-sector-group`]).has(occupancy[leg].sectorId)) report(`${leg}-sector-not-allowed`);
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
