---
title: Planning application staging component
description: Authoritative draft, validation, review, and publication boundary
---

## Status

This cloud-free component implements the authoritative application boundary
defined by the
[AI chat, application API, and MCP specification](../../docs/ai-chat-api-mcp-component-spec.md).
It is the shared command and query target for future UI, HTTP, assistant, and
MCP adapters.

## Included

- Immutable published plan and versioned draft snapshots
- Deterministic snapshot fingerprints
- Typed batch assignment changes
- Non-mutating preview followed by validated commit
- Optimistic version checks
- Idempotency keys with changed-content conflict detection
- Explicit success, rejection, not-found, conflict, and unauthorized results
- Pending, approved, rejected, and published review states
- Exact reviewed-revision fingerprints
- Human-only approval and publication
- In-memory repository behavior for local tests
- Pluggable complete-revision validator and ID generator

## Authority

Agents and service identities may receive explicit permissions to read, create
drafts, preview or commit draft changes, and submit exact revisions for review.
The application service rejects approval and publication unless the actor is an
authenticated human with the required permission.

Permissions are evaluated at every application operation. Future HTTP and MCP
adapters must map authenticated principals into `PlanningActor`; they must not
duplicate or bypass these checks.

## Explicitly excluded

- Concrete MCP transport or SDK host
- Model-provider integrations
- Database persistence
- Distributed locks or transactions
- Domain-specific candidate generation
- Domain-specific rule implementations
- Automatic approval or publication

## HTTP adapter

`Planning.Application.Http` exposes the same authoritative application service
used by local tests. Its planning routes are:

- `GET /api/v1/plans/{planId}`
- `POST /api/v1/drafts`
- `POST /api/v1/drafts/{draftId}/preview`
- `POST /api/v1/drafts/{draftId}/changes`
- `POST /api/v1/drafts/{draftId}/reviews`
- `GET /api/v1/reviews/{reviewId}`
- `POST /api/v1/reviews/{reviewId}/decision`
- `POST /api/v1/reviews/{reviewId}/publish`

The assistant routes are:

- `POST /api/v1/assistant/responses`
- `POST /api/v1/assistant/responses/stream`

The complete-response route preserves structured context and typed output
parts. The streaming route emits the provider-neutral ordered protocol over
server-sent events and flushes every event.

Application failures map consistently:

- Rejected requests return 422
- Missing resources return 404
- Version or idempotency conflicts return 409
- Authorization failures return 403
- Assistant provider failures return 502

Problem details include a stable `errorCode`. Rule rejection also includes
typed validation evidence.

### Local actor headers

The runnable fixture uses `DevelopmentHeaderActorResolver`:

- `X-Planning-Actor-Id`
- `X-Planning-Actor-Kind`
- `X-Planning-Actor-Access`

This resolver exists only for deterministic local execution. A deployed adapter
must replace it with an authenticated principal resolver. The core application
still evaluates actor kind and access for every operation, including the
human-only approval and publication checks.

## MCP adapter

`Planning.Application.Mcp` provides a framework-neutral catalog and invocation
boundary. A concrete MCP host can bind its own transport and SDK types to these
contracts without moving business rules into the host.

| Tool | Authority | Idempotency key | Human confirmation |
|------|-----------|-----------------|--------------------|
| `get_plan` | Read | No | No |
| `create_draft` | Draft write | Yes | No |
| `preview_changes` | Draft write | No | No |
| `commit_changes` | Draft write | Yes | Yes |
| `submit_for_review` | Review submit | Yes | Yes |
| `get_review_status` | Read | No | No |

Each tool has a stable ID, semantic version, JSON input schema, authority class,
and confirmation metadata. Every invocation returns a normalized result
envelope with a correlation ID, typed status, optional payload, stable error
code, retryability, and truncation state.

The adapter calls the planning HTTP API and propagates actor and correlation
headers. It does not call application-core implementations directly. MCP actor
identity uses the local development headers in this fixture; production hosts
must obtain equivalent identity and grants from authenticated principals.

Approval, rejection, and publication tools are deliberately absent. Those
operations remain human-only at the application boundary and are not delegated
to an agent tool surface.

### Streamable HTTP host

`Planning.Application.Mcp.Http` binds the framework-neutral adapter to the
official `ModelContextProtocol.AspNetCore` SDK. It exposes:

- Stateless Streamable HTTP at `/mcp`
- A liveness endpoint at `/healthz`
- Protocol-native tool discovery and invocation
- Structured MCP results plus a concise text summary
- Read-only, idempotent, destructive, and open-world protocol annotations

The tool catalog marks every operation as non-destructive because the surface
cannot approve, reject, publish, or delete plans. `commit_changes` and
`submit_for_review` descriptions preserve their host-side human-confirmation
requirement.

The local host reads these configuration values:

| Configuration | Purpose |
|---------------|---------|
| `PlanningApi:BaseAddress` | Authoritative planning HTTP API origin |
| `McpActor:Id` | Local service actor identifier |
| `McpActor:Kind` | Actor kind propagated to the planning API |
| `McpActor:Access` | Explicit planning grants propagated to the API |

> [!WARNING]
> The configured actor uses the planning API's development headers. Run this
> host only as a local deterministic fixture. A deployed host must authenticate
> callers and map trusted principals to planning actors instead of accepting or
> forwarding model-generated identity.

## Run locally

```powershell
dotnet test .\components\Planning.Application\tests\Planning.Application.Core.Tests\Planning.Application.Core.Tests.csproj
dotnet test .\components\Planning.Application\tests\Planning.Application.Http.Tests\Planning.Application.Http.Tests.csproj
dotnet test .\components\Planning.Application\tests\Planning.Application.Mcp.Tests\Planning.Application.Mcp.Tests.csproj
dotnet test .\components\Planning.Application\tests\Planning.Application.Mcp.Http.Tests\Planning.Application.Mcp.Http.Tests.csproj
dotnet run --project .\components\Planning.Application\src\Planning.Application.Http\Planning.Application.Http.csproj
```

Run the planning API and MCP host in separate terminals:

```powershell
dotnet run --project .\components\Planning.Application\src\Planning.Application.Http\Planning.Application.Http.csproj --urls http://localhost:5050
```

```powershell
$env:PlanningApi__BaseAddress = "http://localhost:5050"
dotnet run --project .\components\Planning.Application\src\Planning.Application.Mcp.Http\Planning.Application.Mcp.Http.csproj --urls http://localhost:5051
```

## Next boundary

Replace local actor headers with authenticated principal mapping, then connect
the provider-neutral assistant runtime to this MCP endpoint. Do not implement
planning search, validation, scoring, rollback, review eligibility, or
publication behavior in the MCP host.
