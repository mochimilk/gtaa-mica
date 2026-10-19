---
title: Planning timeline lifecycle demonstration
description: Runnable synthetic edit, compare, review, and publication workflow
---

## Workflow

The demonstration loads the local synthetic plan, creates an isolated draft,
and exercises the complete reusable-component lifecycle.

1. Edit the schedule through authoritative preview and commit.
2. Compare the immutable baseline with the current draft over shared rows,
   horizon, identities, filters, and metric definitions.
3. Review independently produced synthetic evidence for the exact draft
   fingerprint.
4. Submit as an agent, decide as a human reviewer, and publish as a human
   publisher.

Rejected previews retain the current draft and display validation evidence.
Accepted previews remain uncommitted until the user selects `Commit draft`.
Successful commits replace the rendered snapshot with the returned version.
The comparison reports placement classifications and raw manufacturing metric
deltas. The review view reconciles the full two-item fixture population and
shows that agent views cannot approve or publish.

The demonstration uses reservation intervals as authoritative occupancy. It
does not silently derive application times from visual padding.

> [!NOTE]
> The browser evidence generator is a second deterministic implementation of
> the synthetic resource-overlap rule. It exists to exercise the portable
> review-evidence contract. A destination application must obtain this evidence
> from its independently callable complete-plan validator over frozen inputs,
> not trust validation performed in a browser.

## Run locally

Start the authoritative local planning API:

```powershell
dotnet run --project .\components\Planning.Application\src\Planning.Application.Http\Planning.Application.Http.csproj --urls http://localhost:5050
```

Start the demonstration in a second terminal:

```powershell
Set-Location .\components\Planning.Timeline.Demo
npm install
npm run dev
```

Open the local URL printed by Vite. The development proxy forwards
`/planning-api` to the planning API without enabling broad cross-origin access.

## Validate

```powershell
Set-Location .\components\Planning.Timeline.Demo
npm run build
```

The browser-verified synthetic scenario proves:

- Overlapping movement returns `RESOURCE_OVERLAP` without changing the draft
- Accepted movement remains a preview until explicit commit
- Commit advances the draft from version 1 to version 2
- Comparison reports one moved and retimed item and one unchanged item
- Shared comparison evidence produces raw, comparable manufacturing deltas
- Review evidence reconciles all two fixture items with zero findings and zero
  unverifiable checks
- An agent submits the exact revision but cannot approve or publish
- A human reviewer approves and a separate human publisher publishes
- Publication records the exact approved fingerprint and published plan ID
- Editing after submission disables review controls and the API returns
  `409 REVIEW_DRAFT_CHANGED`

> [!WARNING]
> This is a local deterministic fixture. Its development actor headers are not
> a production authentication mechanism.
