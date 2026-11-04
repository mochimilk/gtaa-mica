import { orbShaderSource } from "./shader-source";

/**
 * One WebGPU device, and the orb shader compiled once into its three
 * pipelines, shared by every orb on the page (createOrbRenderer).
 *
 * Each orb used to make its own device and compile the shader into its
 * pipelines on the spot, synchronously. On Windows that compilation runs
 * through Direct3D's compiler on the GPU process's main thread, the one
 * that draws the page, so the page froze for as long as it took, once per
 * orb: 10 s to 2 min in the Windows app (desktop/), measured. Now it is
 * compiled once, with createRenderPipelineAsync, which lets the browser
 * compile off that thread, and orbs show their placeholder until it's ready.
 */
export type OrbGpu = {
  device: GPUDevice;
  format: GPUTextureFormat;
  pipeline: GPURenderPipeline;
  ribbonPipeline: GPURenderPipeline;
  ribbonCompositePipeline: GPURenderPipeline;
  sampler: GPUSampler;
};

let shared: Promise<OrbGpu> | null = null;

/** The shared device and pipelines, made on first use, and again after the device is lost. */
export function orbGpu(): Promise<OrbGpu> {
  if (!shared) {
    const made: Promise<OrbGpu> = create().then(
      (gpu) => {
        // A lost device is made again for the orbs that come next; the ones
        // using it fail to their placeholder (createOrbRenderer).
        void gpu.device.lost.then(() => {
          if (shared === made) shared = null;
        });
        return gpu;
      },
      (error: unknown) => {
        if (shared === made) shared = null;
        throw error;
      },
    );
    shared = made;
  }
  return shared;
}

/** Premultiplied "over", as each orb composites onto the page. */
const over: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

async function create(): Promise<OrbGpu> {
  if (!navigator.gpu) {
    throw new Error("This browser does not support WebGPU");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No WebGPU adapter is available");
  }
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();

  try {
    const shader = device.createShaderModule({
      label: "orb-glass-liquid",
      code: orbShaderSource,
    });
    const compilation = await shader.getCompilationInfo();
    const compilationErrors = compilation.messages.filter((message) => message.type === "error");
    if (compilationErrors.length > 0) {
      throw new Error(
        compilationErrors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join("\n"),
      );
    }

    const [pipeline, ribbonPipeline, ribbonCompositePipeline] = await Promise.all([
      device.createRenderPipelineAsync({
        label: "orb-glass-liquid-pipeline",
        layout: "auto",
        vertex: { module: shader, entryPoint: "vs_main" },
        fragment: { module: shader, entryPoint: "fs_main", targets: [{ format, blend: over }] },
        primitive: { topology: "triangle-list" },
      }),
      device.createRenderPipelineAsync({
        label: "particle-ribbon-pipeline",
        layout: "auto",
        vertex: { module: shader, entryPoint: "ribbon_vs_main" },
        fragment: {
          module: shader,
          entryPoint: "ribbon_fs_main",
          targets: [{
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: over.alpha,
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      }),
      device.createRenderPipelineAsync({
        label: "particle-ribbon-glass-composite-pipeline",
        layout: "auto",
        vertex: { module: shader, entryPoint: "vs_main" },
        fragment: { module: shader, entryPoint: "ribbon_composite_fs_main", targets: [{ format, blend: over }] },
        primitive: { topology: "triangle-list" },
      }),
    ]);
    const sampler = device.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
    });
    return { device, format, pipeline, ribbonPipeline, ribbonCompositePipeline, sampler };
  } catch (error) {
    device.destroy();
    throw error;
  }
}
