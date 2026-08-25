import { WebGpuInfo } from "./webGpu";

export type GpuBrowser = "chromium" | "firefox";
export type GpuHealth = "ok" | "software" | "unavailable";

export interface GpuDiagnosis {
  health: GpuHealth;
  /** true when this should read as a warning (underpowered/unavailable). */
  warn: boolean;
  /** Footer text. Empty when there's nothing worth showing (a healthy GPU whose
   *  identity the browser hides — no signal, no clutter). */
  text: string;
}

// Substrings that identify a CPU software renderer in an adapter's identity.
// Microsoft's WARP renderer surfaces as "Microsoft Basic Render Driver", so
// "basic render" covers it — no need for a bare "warp" (which risks matching a
// real device name).
const SOFTWARE_MARKERS = ["llvmpipe", "lavapipe", "swiftshader", "software", "basic render", "microsoft basic"];

const FLAGS: Record<GpuBrowser, string> = {
  chromium: "enable chrome://flags #enable-vulkan and #enable-unsafe-webgpu, then restart Chrome (chrome://gpu shows the active backend)",
  firefox: "enable dom.webgpu.enabled in about:config, then restart (WebGPU on Linux is still experimental)",
};

/**
 * Classify the WebGPU adapter for the footer: warn when it's a CPU software
 * renderer (very slow shader compiles / freezes) or WebGPU is unavailable, with
 * the browser-specific flags to fix it. A healthy hardware GPU shows its identity
 * (debugging) when the browser exposes it, or nothing when it's privacy-hidden.
 * Detection is limited to what the WebGPU API reveals — Chrome hides the adapter
 * string, so software is caught mainly via `isFallback`; check chrome://gpu when
 * the model is slow but nothing here fires.
 */
export function diagnoseGpu(info: WebGpuInfo, browser: GpuBrowser): GpuDiagnosis {
  const flags = FLAGS[browser];
  if (!info.available) {
    return { health: "unavailable", warn: true, text: `⚠️ WebGPU unavailable — the on-device model needs it. To enable it, ${flags}.` };
  }
  const adapterLc = info.adapter.toLowerCase();
  if (info.isFallback || SOFTWARE_MARKERS.some((m) => adapterLc.includes(m))) {
    const who = info.adapter || "a CPU software renderer";
    return {
      health: "software",
      warn: true,
      text: `⚠️ WebGPU is running on ${who} — shader compiles are very slow and can freeze the tab. For hardware acceleration, ${flags}.`,
    };
  }
  return { health: "ok", warn: false, text: info.adapter ? `GPU: ${info.adapter}` : "" };
}
