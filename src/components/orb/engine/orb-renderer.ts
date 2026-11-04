import { particleRibbonInstanceCount } from "./particle-ribbon";
import { styleFlowIndexes, type OrbParams } from "./presets";
import {
  createOrbTransitionController,
  type OrbRenderTarget,
} from "./orb-states";
import { orbUniformFloatCount, writeOrbUniforms } from "./orb-uniforms";
import { orbGpu } from "./orb-gpu";
import { applyAudioUniforms, type AudioBands } from "./orb-audio";

export type OrbRendererOptions = {
  canvas: HTMLCanvasElement;
  getTarget: () => OrbRenderTarget;
  getAudioBands?: (dt: number) => AudioBands;
  onError: (error: Error) => void;
  onReady: () => void;
};

/**
 * Draws one orb on `canvas` every frame, with the device and pipelines every
 * orb shares (./orb-gpu): `onReady` once its first frame is drawn, `onError`
 * when WebGPU fails it (the orb then shows its placeholder). The returned
 * function stops it and releases what it made, never the shared device.
 */
export function createOrbRenderer({
  canvas,
  getTarget,
  getAudioBands,
  onError,
  onReady,
}: OrbRendererOptions): () => void {
  let disposed = false;
  let animationFrame = 0;
  let device: GPUDevice | null = null;
  let gpuContext: GPUCanvasContext | null = null;
  let uniformBuffer: GPUBuffer | null = null;
  let ribbonTarget: GPUTexture | null = null;
  let readyNotified = false;
  let failed = false;
  let lastFrameAt: number | null = null;
  let motionPhase = 0;
  let stopListening = () => {};

  function release(): void {
    cancelAnimationFrame(animationFrame);
    stopListening();
    ribbonTarget?.destroy();
    ribbonTarget = null;
    uniformBuffer?.destroy();
    uniformBuffer = null;
    gpuContext?.unconfigure();
    gpuContext = null;
  }

  function fail(error: Error): void {
    if (disposed || failed) return;
    failed = true;
    release();
    onError(error);
  }

  async function start(): Promise<void> {
    const gpu = await orbGpu();
    if (disposed) return;
    device = gpu.device;
    const { format, pipeline, ribbonPipeline, ribbonCompositePipeline, sampler: ribbonSampler } = gpu;

    const canvasContext = canvas.getContext("webgpu");
    if (!canvasContext) {
      throw new Error("Could not create a WebGPU canvas context");
    }
    const context: GPUCanvasContext = canvasContext;
    gpuContext = context;
    context.configure({ device, format, alphaMode: "premultiplied" });

    const values = new Float32Array(orbUniformFloatCount);
    const uniforms = device.createBuffer({
      size: values.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    uniformBuffer = uniforms;
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms } }],
    });
    const ribbonBindGroup = device.createBindGroup({
      layout: ribbonPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms } }],
    });
    let ribbonCompositeBindGroup: GPUBindGroup | null = null;
    const transition = createOrbTransitionController(getTarget());

    // The device is every orb's: each listens for its own failure, and stops listening when done.
    const shared = device;
    void shared.lost.then((info) => {
      fail(new Error(`WebGPU device lost: ${info.message || info.reason}`));
    });
    const onUncapturedError = (event: GPUUncapturedErrorEvent) => {
      event.preventDefault();
      fail(new Error(`WebGPU render error: ${event.error.message}`));
    };
    shared.addEventListener("uncapturederror", onUncapturedError);
    stopListening = () => shared.removeEventListener("uncapturederror", onUncapturedError);

    function resize(): void {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        ribbonTarget?.destroy();
        ribbonTarget = null;
        ribbonCompositeBindGroup = null;
      }
    }

    function ensureRibbonTarget(): void {
      if (ribbonTarget && ribbonCompositeBindGroup) return;

      ribbonTarget = device!.createTexture({
        label: "particle-ribbon-offscreen-texture",
        size: { width: canvas.width, height: canvas.height },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      ribbonCompositeBindGroup = device!.createBindGroup({
        layout: ribbonCompositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniforms } },
          { binding: 1, resource: ribbonTarget.createView() },
          { binding: 2, resource: ribbonSampler },
        ],
      });
    }

    function frame(now: number): void {
      if (disposed || failed || !device) {
        return;
      }

      try {
        resize();
        const params: OrbParams = transition.sample(getTarget(), now);
        const frameDelta = lastFrameAt === null
          ? 0
          : Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
        lastFrameAt = now;
        writeOrbUniforms(
          values,
          canvas.width,
          canvas.height,
          0,
          params,
        );
        if (getAudioBands) applyAudioUniforms(values, getAudioBands(frameDelta));
        motionPhase += frameDelta * Math.max(values[3], 0);
        values[2] = motionPhase / Math.max(values[3], 0.001);
        device.queue.writeBuffer(uniforms, 0, values);

        const isParticleRibbon =
          styleFlowIndexes[params.style] === styleFlowIndexes.particleRibbon;
        const encoder = device.createCommandEncoder();
        if (isParticleRibbon) {
          ensureRibbonTarget();
          const particlePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: ribbonTarget!.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          particlePass.setPipeline(ribbonPipeline);
          particlePass.setBindGroup(0, ribbonBindGroup);
          particlePass.draw(6, particleRibbonInstanceCount, 0, 0);
          particlePass.end();
        }
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        if (isParticleRibbon) {
          pass.setPipeline(ribbonCompositePipeline);
          pass.setBindGroup(0, ribbonCompositeBindGroup!);
        } else {
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
        }
        pass.draw(3, 1, 0, 0);
        pass.end();
        device.queue.submit([encoder.finish()]);
        if (!readyNotified) {
          readyNotified = true;
          onReady();
        }
        animationFrame = requestAnimationFrame(frame);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    }

    animationFrame = requestAnimationFrame(frame);
  }

  start().catch((error: unknown) => {
    fail(error instanceof Error ? error : new Error(String(error)));
  });

  return () => {
    disposed = true;
    release();
  };
}
