# Orb engine (vendored)

WebGPU renderer for the liquid-glass orb, copied from
[LerSent001/orb](https://github.com/LerSent001/orb) at commit `8d1736e`
(MIT, see `LICENSE`). Only the rendering core is included; the upstream
editor UI, Toolcraft components, Tailwind and code exporters are not.

Use it through `LiveOrb` (`../LiveOrb.tsx`) rather than importing from here.

## Local changes

- Error messages translated from Chinese to English (`orb-renderer.ts`,
  `presets.ts`).
- `shader-source.ts` imports `./effect.wgsl?raw` (the shader moved next to it).

Keep other edits out of these files so upstream fixes can be diffed in.

## WebGPU types

`webgpu.d.ts` is `@webgpu/types@0.1.66/dist/index.d.ts` (BSD-3-Clause, see
`LICENSE-webgpu-types`). It is vendored because `npm install` cannot currently
resolve this project's lockfile against the package feed. Once it can, replace
it with an `@webgpu/types` devDependency.
