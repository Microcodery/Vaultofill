import { describe, it, expect } from "vitest";
import { diagnoseGpu } from "../../../src/ext/panel/gpuDiagnostics";
import { WebGpuInfo } from "../../../src/ext/panel/webGpu";

const info = (o: Partial<WebGpuInfo>): WebGpuInfo => ({ available: true, shaderF16: true, adapter: "", isFallback: false, ...o });

describe("diagnoseGpu", () => {
  it("warns with Chrome flags when WebGPU is unavailable", () => {
    const d = diagnoseGpu(info({ available: false }), "chromium");
    expect(d.health).toBe("unavailable");
    expect(d.warn).toBe(true);
    expect(d.text).toMatch(/WebGPU unavailable/);
    expect(d.text).toMatch(/enable-vulkan|enable-unsafe-webgpu/);
  });

  it("warns with Firefox guidance when unavailable on Firefox", () => {
    const d = diagnoseGpu(info({ available: false }), "firefox");
    expect(d.text).toMatch(/about:config|dom\.webgpu\.enabled/);
    expect(d.text).not.toMatch(/chrome:\/\/flags/);
  });

  it("flags a software renderer identified by its adapter string", () => {
    const d = diagnoseGpu(info({ adapter: "Mesa llvmpipe (LLVM 17)" }), "chromium");
    expect(d.health).toBe("software");
    expect(d.warn).toBe(true);
    expect(d.text).toMatch(/llvmpipe/);
    expect(d.text).toMatch(/very slow/);
  });

  it("flags a software renderer via isFallback even when the identity is hidden (Chrome)", () => {
    const d = diagnoseGpu(info({ adapter: "", isFallback: true }), "chromium");
    expect(d.health).toBe("software");
    expect(d.warn).toBe(true);
    expect(d.text).toMatch(/software renderer/);
  });

  it("matches known software markers case-insensitively (SwiftShader, lavapipe)", () => {
    expect(diagnoseGpu(info({ adapter: "Google SwiftShader" }), "chromium").health).toBe("software");
    expect(diagnoseGpu(info({ adapter: "llvmpipe / LAVAPIPE" }), "firefox").health).toBe("software");
  });

  it("a healthy hardware GPU shows its identity and does not warn", () => {
    const d = diagnoseGpu(info({ adapter: "AMD Radeon RX 6800 (RADV NAVI21)" }), "chromium");
    expect(d.health).toBe("ok");
    expect(d.warn).toBe(false);
    expect(d.text).toBe("GPU: AMD Radeon RX 6800 (RADV NAVI21)");
  });

  it("a healthy GPU with a hidden identity shows nothing (no clutter)", () => {
    const d = diagnoseGpu(info({ adapter: "" }), "chromium");
    expect(d.health).toBe("ok");
    expect(d.warn).toBe(false);
    expect(d.text).toBe("");
  });
});
