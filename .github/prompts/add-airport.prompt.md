---
description: "Use when adding or onboarding an airport from terminal diagrams, ASM PDFs, stand permissions and longitude/latitude coordinates, then creating an approved synthetic demand profile."
agent: agent
argument-hint: "airportId=... sources=... [milestone=stubs|stand-schedule]"
---

# Add an airport from evidence

## Inputs

* ${input:airportId}: Stable airport ID, inferred from the request when supplied.
* ${input:sources}: Source documents, diagrams and geographic control information.
* ${input:milestone:stubs}: Requested milestone: source-backed stubs or a synthetic stand schedule.

## Required steps

1. Read the [onboarding guide](../../docs/airport-onboarding.md) and relevant
   [stand rules](../../docs/stand-rules.md). Inspect the working tree and the
   existing target airport before writing. Preserve user edits and existing IDs.
2. Gather missing identity, catalog country, IANA time zone, inventory,
   source revisions, contact/airline/sector permissions and geographic anchors.
   Ask questions together using the available question tool. Record source-backed
   facts, user inputs, synthetic assumptions and unresolved gaps separately.
3. Use [GTAA](../../docs/gtaa-airport.md) as the source-evidence/variant example
   and [Contoso](../../docs/scenario-generation.md) as the profile/process example.
   Use actual schemas and loader contracts from the guide; do not invent formats.
   Keep both existing airports and their defaults unchanged.
4. Align diagrams using the exact confirmed anchor feature, scale, orientation,
   crop/resizing history and independently checked control points. Store geographic
   coordinates as `[longitude, latitude]`. Preserve source coordinates and
   transforms. Flag placeholders, distinguish labels from parking points and
   do not infer geographic accuracy from drawing residuals or zoom alone.
5. Extract physical ASM table cells and section-scoped rules before expanding
   aircraft shorthand. Preserve raw evidence, exact variants, leg-specific
   exceptions and directional neighbor semantics. Leave ambiguous expressions
   unresolved rather than granting compatibility. Do not bypass encrypted sources.
6. Reuse verified [GTAA aircraft facts](../../data/airports/gtaa/aircraft.json)
   through airport-local records, retaining provenance and explicit ID mappings.
   Review known external-code audit gaps before copying designators. Do not
   deduplicate on IATA/ICAO codes, confuse ICAO size letters with designators,
   copy GTAA stand permissions or assume all seat layouts apply to every operator.
7. Create airport-local stubs, source evidence and data gaps. Keep unknown stands
   geometry-only and planning/routing readiness false. Require explicit user
   approval before promoting any stand to ready. Check gate inverses, separate
   arrival/departure permissions, explicit airline authorization and manual
   procedure limitations. Do not invent permissions to make a schedule fit.
8. For the stand-schedule milestone, confirm date, visit volume, sector/market
   split, fleet/operators, PAX, stays, boundaries and tow assumptions. Follow
   the existing scenario-profile schema and the 1-200-visit, 1-48-hour limits.
   Use eligible-stand-share allocation if requested. Keep a separate local tow
   profile, initially disabling elective movements unless requested.
9. Validate before generation. Require seats within configured PAX bounds and
   an eligible ready continuous-stay stand for every traffic row. For Canada,
   author separate US transborder and non-US international markets. Do not
   silently relabel unsupported sectors or guess route policies.
10. Run generation and, when requested, native assignment with explicit airport,
    scenario and tow-profile paths. Use new output filenames. Do not overwrite
    source data or run GTAA-specific regeneration on another airport. Explain
    documented runner exit codes instead of treating every nonzero exit as a
    failure or every written file as success.
11. Run focused regression checks. Verify exact counts, dates, linkage, PAX,
    route geography, deterministic generation and independent stand validation.
    Report solver status, assigned/unassigned visits, movements, evidence paths
    and outstanding decisions. Do not hide partial results, certify operational
    readiness or claim CLI outputs automatically appear in the viewer.

---

Start with the requested airport and source intake. Complete only the approved
milestone, asking for missing decisions before changing behavior or scope.
