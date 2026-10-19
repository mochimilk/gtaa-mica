---
title: Planning assistant staging component
description: Provider-neutral assistant contracts and deterministic local runtime
---

## Status

This staging component implements the first slice of the
[AI chat, application API, and MCP specification](../../docs/ai-chat-api-mcp-component-spec.md).
It has no Azure, Microsoft Foundry, MCP framework, HTTP, persistence, or planning
domain dependency.

## Included

- Structured context references instead of prompt-injected resource IDs
- Provider-neutral complete-response contract
- Typed notice, resource-reference, and action-proposal output parts
- Versioned ordered streaming events
- Explicit activity, text, output, completion, and failure events
- Opaque conversation tokens
- Cancellation propagation
- Deterministic scripted runtime for local development and tests
- Explicit failure for an unconfigured scripted request

## Boundary

`Planning.Assistant.Core` owns conversation and streaming contracts. It does not
own:

- Planning commands or queries
- Draft or review state
- MCP tool definitions
- HTTP or server-sent event serialization
- Provider authentication or transport
- UI rendering
- Domain entities such as flights, stands, jobs, or machines

The next slice should define application command/query ports and an in-memory
draft and review fixture. HTTP and MCP adapters should follow only after that
authoritative boundary is executable.

## Run locally

```powershell
dotnet test .\components\Planning.Assistant\tests\Planning.Assistant.Core.Tests\Planning.Assistant.Core.Tests.csproj
```
