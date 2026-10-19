---
title: Planning timeline application adapter
description: Translate timeline move intents into authoritative planning preview and commit requests
---

## Boundary

This package connects domain-neutral timeline intents to the planning HTTP API.
It does not validate changes locally or mutate renderer state.

The caller must choose whether the authoritative assignment uses the item's
`display` or `reservation` interval. This choice is explicit for every preview
and commit so a destination cannot silently reinterpret forecast padding as
operational occupancy.

## Included

- Get-plan and create-draft requests
- Move-intent to typed application-change translation
- Non-mutating move preview
- Versioned and idempotent move commit
- Development actor-header propagation
- Structured rejection, conflict, authorization, and transport results
- Validation-evidence preservation
- Cancellation propagation
- Exact-version review submission
- Review-status retrieval
- Typed human approve or reject decisions
- Publication of the exact approved revision

The review methods expose the authoritative application routes used by
[`Planning.Timeline.Review`](../Planning.Timeline.Review/README.md). Supplying
human actor headers in a browser is still local-fixture behavior. Production
identity and permissions must come from a trusted server boundary.

> [!WARNING]
> Development actor headers support only the local deterministic fixture.
> Production browser applications must use an authenticated backend-for-frontend
> or equivalent trusted principal adapter.

## Validate

```powershell
Set-Location .\components\Planning.Timeline.Application
npm install
npm run check
```
