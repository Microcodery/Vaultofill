export interface WebGpuInfo {
  /** A usable WebGPU adapter could actually be acquired (not just navigator.gpu). */
  available: boolean;
  /** The adapter exposes the `shader-f16` feature. Many Linux drivers and older
   *  GPUs don't, and f16 model shaders (`enable f16;`) fail to compile there, so
   *  callers pick an f32 model when this is false. */
  shaderF16: boolean;
  /** Human-readable adapter identity (vendor / architecture / description), for
   *  diagnostics. A value like "llvmpipe"/"lavapipe"/"SwiftShader" means WebGPU
   *  fell back to a CPU software renderer — the usual cause of minutes-long shader
   *  compiles and browser freezes. Empty when unknown/unavailable (Chrome
   *  privacy-sanitizes adapter info to empty strings by default). */
  adapter: string;
  /** The adapter reports itself as a software/fallback renderer
   *  (`adapter.isFallbackAdapter`, e.g. Chrome's SwiftShader) — a reliable
   *  "not hardware-accelerated" signal even when the identity string is hidden. */
  isFallback: boolean;
}

const UNAVAILABLE: WebGpuInfo = { available: false, shaderF16: false, adapter: "", isFallback: false };

interface AdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

type Adapter = {
  features?: { has(name: string): boolean };
  info?: AdapterInfoLike;
  requestAdapterInfo?(): Promise<AdapterInfoLike>;
  isFallbackAdapter?: boolean;
};

type Gpu = {
  requestAdapter(): Promise<Adapter | null>;
};

/** Best-effort adapter identity string across API versions (`adapter.info`
 *  getter on newer browsers, `requestAdapterInfo()` on older ones). */
async function adapterLabel(adapter: Adapter): Promise<string> {
  let info: AdapterInfoLike | undefined;
  try {
    info = adapter.info; // spec'd as a getter — don't let a throw fail the probe
  } catch {
    info = undefined;
  }
  if (!info && adapter.requestAdapterInfo) {
    info = await adapter.requestAdapterInfo().catch(() => undefined);
  }
  if (!info) return "";
  return [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(" ").trim();
}

/**
 * Probe a WebGPU `gpu` for a usable adapter and its f16 shader support. Returns
 * `available:false` when there's no gpu, no adapter, or the request throws — a
 * flag-less Linux browser exposes `navigator.gpu` but yields no adapter, so
 * existence alone isn't enough. Kept pure so it's unit-testable without a real GPU.
 *
 * `available:true` is necessary but not sufficient: web-llm still calls
 * `adapter.requestDevice()`, which can fail on an adapter-but-no-device machine —
 * that residual case degrades gracefully (the load throws, the pipeline stays on
 * the endpoint), it just isn't pre-empted here.
 */
export async function probeAdapter(gpu: Gpu | undefined): Promise<WebGpuInfo> {
  if (!gpu) return UNAVAILABLE;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return UNAVAILABLE;
    return {
      available: true,
      shaderF16: adapter.features?.has("shader-f16") ?? false,
      adapter: await adapterLabel(adapter),
      isFallback: adapter.isFallbackAdapter ?? false,
    };
  } catch {
    return UNAVAILABLE;
  }
}

export function webGpuInfo(): Promise<WebGpuInfo> {
  if (typeof navigator === "undefined") return Promise.resolve(UNAVAILABLE);
  const nav = navigator as unknown as { gpu?: Gpu };
  return probeAdapter(nav.gpu);
}
