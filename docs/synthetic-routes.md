---
title: Airport catalogs and synthetic route preferences
description: Validate airline and airport reference data and derive repeatable host-specific route choices from minimal hub and carrier hints.
---

## Validate the reference data

The [airport catalog](../data/airports.json) describes reference locations, not
terminal geometry or stand infrastructure. Its
[schema](../data/schemas/airports.schema.json) requires an uppercase three-letter
`code`, `name`, `city` and `country`. Country values match the
[airline catalog](../data/airlines.json) exactly, including territories represented
separately in these catalogs.

```powershell
npm run validate:catalogs
npm run validate:catalogs -- --host YYZ
npm run test:catalogs
```

Validation checks shapes, unique airport codes, unique airline IDs/IATA/ICAO
codes, home-country airport coverage, hub references and configured host
rosters. Hub hints must include at least one home-country airport but may also
include foreign bases, such as CPH for Scandinavian Airlines. Duplicate roster
entries, unknown references, all-zero shares and enabled carriers with no
external route choices are errors. A zero-weight entry still needs a valid
airline reference.

These checks do not verify real airline service, published hubs, airport
geography, fleet range, frequencies or operating rights.

## Minimal configuration

An airline can provide `hub_airports`, an optional list of airport codes:

```json
{
  "id": "airline:ACA",
  "name": "Air Canada",
  "icao": "ACA",
  "iata": "AC",
  "country": "Canada",
  "hub_airports": ["YYZ", "YUL", "YVR"]
}
```

The checked-in hints are illustrative preferences within the available catalog,
not an exhaustive or verified current network. Countries with one catalog
airport need no hub hint. With multiple home-country airports and no hint,
validation warns explicitly and derivation uses those airports equally.

A host airport opts in by listing its synthetic airlines:

```json
"airlines": [
  { "airline_id": "airline:ACA", "weight": 8 },
  { "airline_id": "airline:UAL", "weight": 2 },
  { "airline_id": "airline:BAW" }
]
```

The catalog includes a small illustrative YYZ roster. It is not an assertion
that these are its only airlines. Other airports remain unconfigured until
given a roster; the generator never assumes that every catalog airline serves
every airport.

Weights are relative, not flight counts or percentages. Omitted carrier weights
default to 4 for a carrier from the host country or based at the host, and 1
otherwise. An explicit zero disables a carrier. No primary-carrier flag or
complete route matrix is required.

## Derived connections

The [route module](../scripts/airport-catalogs.mjs) builds two independent weighted
choices:

1. Choose an enabled airline using its host-specific carrier weight.
2. Choose an external endpoint within that airline's derived route pool.

For a home-country host or an airline's configured hub, the route pool contains
the airline's home-country airports and its configured hubs. For other hosts,
the route pool contains only the airline's configured hubs. Without hub hints,
the pool uses home-country airports, with the warning described above when
there is more than one.

The host itself is always excluded. Each explicit hub has route weight 5;
other home-country airports have weight 1. The output exposes these weights,
their `basis` and normalized probabilities. An airline with many endpoints
does not gain a larger carrier share because of its route count.

For example, United at YYZ draws from its configured US hubs instead of every
US airport. Air Canada at YYZ favors YVR/YUL over other Canadian endpoints.
This first approximation does not invent worldwide routes for every local
carrier. It does not yet generate a local carrier's complete international
network; use authored raw demand when those details matter.

## Repeatable sampling

```javascript
import { createRouteSampler, loadCatalogs } from './scripts/airport-catalogs.mjs';

const { profile, sample } = createRouteSampler(loadCatalogs(), 'YYZ');
const endpoint = sample({
  seed: 'customer-demo-v1',
  key: 'visit:12:arrival',
  airline_id: 'airline:UAL'
});
```

The optional `airline_id` preserves a caller's existing operating-airline mix.
Omit it to draw from the host roster. Sampling returns `{ airline_id,
airport_code }`; it does not create flight legs, flight numbers or assignments.
Use different stable keys for arrival and departure when they may have different
endpoints. Keys identify source records, not the order in which sampling runs.

Keyed SHA-256 draws use no wall clock, unseeded randomness or AI calls. Identical
catalogs, seed and key reproduce the same choice. Reordering airports, airlines,
hub hints or roster entries does not change profiles or draws. Changing a route
pool or its weights can change the selected endpoint. Separate carrier and
route draws prevent a carrier-share edit from changing endpoint selection for
an explicitly supplied operating airline.

## Scenario integration

This is an authoring foundation, not a live route service. No dependencies,
hosted resources or new styles are needed.

The [scenario generator](scenario-generation.md) now supports a `route_generation`
policy with weighted international and transborder market pools. Its
`createDemandRouteSampler` path uses an explicit manifest host country and the
traffic row's sector. Manifest `iata_code` takes precedence over internal `id`
when excluding the host airport.
Domestic legs select domestic catalog endpoints. International legs select
foreign endpoints from the configured markets. Home-country operators may use
those explicit foreign market choices; foreign operators are restricted to
their hub/home-country choices intersected with the markets.

Transborder legs support the Canada-US country pair in either direction.
They select only partner-country endpoints within the configured markets and
carrier choices; other host countries and empty intersections are explicit
errors. International retains its existing foreign-market semantics. GTAA's
[scenario profile](../data/airports/gtaa/demand/scenario-profile.json) therefore
authors a US transborder market and separate non-US Europe/Asia international
markets rather than relabelling US flights as international.

This scenario override is intentionally narrower than a worldwide airline
network model. It does not change the standalone YYZ roster sampler described
above. Unsupported sector policies and empty route intersections are errors;
sectors are not silently relabeled to fit a sampled airport.

Contoso's [full-day profile](../data/airports/contoso/demand/full-day-profile.json)
derives planning-group shares from eligible stands and selects mostly US
carriers, with 12 Europe visits and 12 Asia visits. Each market has a stable
ID, relative weight and weighted airport list. Major-hub weights are illustrative,
not externally sourced rankings. Route decisions use separate stable source-leg
keys, allowing different arrival and departure endpoints.

The original demo fixture remains unchanged. Comfortable/constrained use readable
IATA flight labels and catalog endpoints while preserving their timings,
passenger draws and measured stand-assignment outcomes. Full day is an additional
choice in the existing selector, not a replacement. No new components or tokens
are introduced.

For more realistic or customer-specific schedules, provide
[raw demand JSON](raw-demand.md) rather than adding increasingly detailed
heuristics to this synthetic model.
