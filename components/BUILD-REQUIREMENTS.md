---
title: Component build requirements
description: Required SDKs, shared MSBuild configuration, package versions, project layout, and validation commands for transferred planning components
author: Agentic AOCC team
ms.date: 2026-10-19
ms.topic: reference
---

## Why the copied .NET projects do not restore by themselves

The .NET component project files intentionally inherit their framework and
package versions from shared repository configuration. Copying only the
`components` folder without recreating that configuration produces the
following symptoms:

- MSBuild evaluates `TargetFramework` as empty
- `PackageReference` items have no versions
- restore cannot resolve centrally managed packages
- C# language, nullable, analyzer, and warning settings are absent

This is expected from the current source layout. It does not mean the HTTP or
solver project is standalone as copied.

Before treating the components as runnable, restore the build scaffolding
described below.

## Supported restoration options

Choose one option. Do not maintain two conflicting copies of the same settings.

### Option 1: merge configuration at the destination repository root

Use this option when the destination repository already has shared .NET build
configuration.

Merge the required settings and package versions from:

- `Directory.Build.props`
- `Directory.Packages.props`
- `global.json`

Place the resulting files at a common ancestor of every imported `.csproj`.
MSBuild discovers `Directory.Build.props` and `Directory.Packages.props` by
walking upward from each project directory.

Preserve destination conventions where they are compatible. Resolve version,
target-framework, analyzer, and central-package-management differences
explicitly rather than overwriting the destination files.

### Option 2: make the copied folder self-contained

Use this option for initial evaluation or when the destination repository
should not adopt the component settings globally.

Create these files inside the copied `components` folder:

```text
components/
|-- Directory.Build.props
|-- Directory.Packages.props
|-- BUILD-REQUIREMENTS.md
|-- Planning.Application/
|-- Planning.Assistant/
|-- Planning.Solver/
|-- Planning.Timeline/
`-- ...
```

All projects below `components` will inherit those files. This isolates the
settings from unrelated destination projects.

## .NET toolchain

The extracted .NET components were built and tested with:

| Requirement | Validated value |
| --- | --- |
| .NET SDK | 10.0.402 |
| Target framework | `net10.0` |
| C# language version | 14 |
| Nullable reference types | Enabled |
| Implicit global usings | Enabled |
| Warnings and analyzers | Treated as errors |
| Central package management | Enabled |

Use a .NET 10 SDK. A destination can retarget the components, but retargeting is
a migration task and requires a complete build and test run. Do not remove the
target framework merely to defer that decision.

A minimal component-scoped `Directory.Build.props` is:

```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>14</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <AnalysisLevel>latest-recommended</AnalysisLevel>
    <AnalysisMode>AllEnabledByDefault</AnalysisMode>
    <EnableNETAnalyzers>true</EnableNETAnalyzers>
    <CodeAnalysisTreatWarningsAsErrors>true</CodeAnalysisTreatWarningsAsErrors>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <NoWarn>$(NoWarn);CS1591</NoWarn>
    <Deterministic>true</Deterministic>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.SourceLink.GitHub"
                      PrivateAssets="All" />
  </ItemGroup>
</Project>
```

The `Microsoft.SourceLink.GitHub` reference is optional for a local evaluation.
If it is removed, also remove its package versions from the minimal central
package file.

## Required central NuGet versions

The component `.csproj` files omit versions because the source repository uses
NuGet Central Package Management.

A minimal `components/Directory.Packages.props` for all extracted .NET source
and test projects is:

```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <CentralPackageTransitivePinningEnabled>true</CentralPackageTransitivePinningEnabled>
  </PropertyGroup>

  <ItemGroup>
    <PackageVersion Include="Google.OrTools" Version="9.15.6755" />
    <PackageVersion Include="ModelContextProtocol.AspNetCore" Version="2.2.0" />
    <PackageVersion Include="Microsoft.Extensions.Logging.Abstractions"
                    Version="10.0.10" />
    <PackageVersion Include="Microsoft.AspNetCore.Mvc.Testing"
                    Version="10.0.0" />

    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageVersion Include="xunit" Version="2.9.2" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="3.0.0" />
    <PackageVersion Include="FluentAssertions" Version="7.0.0" />
    <PackageVersion Include="coverlet.collector" Version="6.0.4" />

    <PackageVersion Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />
    <PackageVersion Include="Microsoft.Build.Tasks.Git" Version="10.0.111" />
  </ItemGroup>
</Project>
```

`Microsoft.Extensions.Logging.Abstractions` is pinned because the MCP SDK
dependency graph requires the 10.x line used by the extracted host. The
`Microsoft.Build.Tasks.Git` pin accompanies Source Link and can be omitted if
Source Link is omitted.

If the destination already uses central package management, add these versions
to its existing file. Do not place `Version` attributes on individual
`PackageReference` items while central management remains enabled.

## Required .NET folder relationships

Keep these sibling paths unless the project references are updated:

```text
components/
|-- Planning.Assistant/
|   `-- src/Planning.Assistant.Core/
|-- Planning.Application/
|   |-- src/Planning.Application.Core/
|   |-- src/Planning.Application.Http/
|   |-- src/Planning.Application.Mcp/
|   `-- src/Planning.Application.Mcp.Http/
`-- Planning.Solver/
```

The planning HTTP project references Assistant Core through this relative path:

```text
Planning.Application/src/Planning.Application.Http
../../../Planning.Assistant/src/Planning.Assistant.Core
```

Moving `Planning.Application` without `Planning.Assistant`, or changing their
relative locations, breaks that project reference. Either preserve the sibling
layout or replace the reference with a destination-owned project or NuGet
reference.

The MCP HTTP host depends on both the framework-neutral MCP adapter and the
official MCP ASP.NET Core SDK. The planning application HTTP host depends on
Application Core and Assistant Core.

## Solver native runtime

`Planning.Solver.OrTools` uses Google OR-Tools. The NuGet package carries the
supported native runtime assets, but Linux hosts and containers also require
the GNU OpenMP runtime.

For Debian or Ubuntu images:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
```

Validate OR-Tools on the actual destination operating system and container
base. A successful managed-code build does not prove that the native solver can
load at runtime.

## TypeScript and React toolchain

The timeline packages were validated with:

| Requirement | Validated value |
| --- | --- |
| Node.js | 22.16 |
| TypeScript | 6.0.x |
| React and React DOM | 19.2.x |
| npm | Package manager used by committed lock files |
| Vite | 8.1.x for the demonstration |

Keep the timeline packages as sibling folders while they use local `file:`
dependencies:

```text
components/
|-- Planning.Timeline/
|-- Planning.Timeline.React/
|-- Planning.Timeline.Application/
|-- Planning.Timeline.Compare/
|-- Planning.Timeline.Review/
`-- Planning.Timeline.Demo/
```

The `.npmrc` files in the composite packages set `install-links=true`. This
causes local dependencies to be installed as package artifacts rather than
linked source trees, preventing multiple React runtimes during tests.

Install each package from its own folder. Do not run `npm install` at the
`components` root because it is not an npm workspace.

Build in dependency order:

```powershell
$packages = @(
    ".\components\Planning.Timeline",
    ".\components\Planning.Timeline.React",
    ".\components\Planning.Timeline.Application",
    ".\components\Planning.Timeline.Compare",
    ".\components\Planning.Timeline.Review",
    ".\components\Planning.Timeline.Demo"
)

foreach ($package in $packages) {
    Push-Location $package
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed in $package" }

        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed in $package" }
    }
    finally {
        Pop-Location
    }
}
```

For repeatable CI after lock files are present, use `npm ci` instead of
`npm install`.

## Optional and reference-only components

Not every folder is required by every destination:

| Component | Requirement |
| --- | --- |
| `Planning.Solver` | Include for profile, rule-adapter, candidate, optimization, validation, scoring, and worker capabilities |
| `Planning.Assistant` | Required by the current planning HTTP host and useful for provider-neutral assistant contracts |
| `Planning.Application` | Include for authoritative drafts, review, HTTP, and MCP |
| `Planning.Timeline` | Required by every timeline package |
| `Planning.Timeline.React` | Required for React rendering |
| `Planning.Timeline.Application` | Include when timeline intents call the planning HTTP API |
| `Planning.Timeline.Compare` | Optional comparison workspace |
| `Planning.Timeline.Review` | Optional evidence and review workspace |
| `Planning.Timeline.Demo` | Reference application and acceptance proof, not a production dependency |

The demo uses local development actor headers and synthetic validation. Do not
copy those mechanisms into production authentication or validation.

## Restore and build checks

Run these checks from the destination repository root after restoring the
shared configuration.

Confirm that MSBuild now evaluates the target framework:

```powershell
dotnet msbuild `
    .\components\Planning.Application\src\Planning.Application.Http\Planning.Application.Http.csproj `
    -getProperty:TargetFramework
```

Expected output includes:

```text
net10.0
```

Restore and build the principal .NET hosts:

```powershell
dotnet restore `
    .\components\Planning.Application\src\Planning.Application.Http\Planning.Application.Http.csproj

dotnet build `
    .\components\Planning.Application\src\Planning.Application.Http\Planning.Application.Http.csproj `
    --no-restore

dotnet build `
    .\components\Planning.Application\src\Planning.Application.Mcp.Http\Planning.Application.Mcp.Http.csproj

dotnet build `
    .\components\Planning.Solver\src\Planning.Solver.Worker.Local\Planning.Solver.Worker.Local.csproj
```

Run all imported .NET test projects:

```powershell
$testProjects = Get-ChildItem `
    .\components `
    -Recurse `
    -Filter *.Tests.csproj

foreach ($project in $testProjects) {
    dotnet test $project.FullName
    if ($LASTEXITCODE -ne 0) {
        throw "Tests failed: $($project.FullName)"
    }
}
```

Then run each TypeScript package's `npm run check` rather than only its build
when preparing a transfer:

```powershell
$packages = @(
    ".\components\Planning.Timeline",
    ".\components\Planning.Timeline.React",
    ".\components\Planning.Timeline.Application",
    ".\components\Planning.Timeline.Compare",
    ".\components\Planning.Timeline.Review"
)

foreach ($package in $packages) {
    Push-Location $package
    try {
        npm run check
        if ($LASTEXITCODE -ne 0) { throw "Checks failed in $package" }
    }
    finally {
        Pop-Location
    }
}

Push-Location .\components\Planning.Timeline.Demo
try {
    npm run build
}
finally {
    Pop-Location
}
```

## Transfer readiness checklist

- A .NET 10 SDK is selected
- Every imported `.csproj` evaluates `TargetFramework` to `net10.0`
- Central package management supplies every versionless `PackageReference`
- `Planning.Application` and `Planning.Assistant` retain a valid relative
  relationship or use replacement package references
- OR-Tools loads on the destination runtime, not only during compilation
- Timeline sibling folders retain valid `file:` dependency paths
- Each npm package has its lock file and `.npmrc` where present
- .NET tests pass
- Timeline checks and the demo build pass
- Local fixture actor headers are not treated as production authentication
- Synthetic browser validation is not treated as authoritative production
  validation

Only after these checks pass should the copied components be described as
runnable in the destination repository.
