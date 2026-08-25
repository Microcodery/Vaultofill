import { describe, it, expect, vi, afterEach } from "vitest";
import { probeAdapter, webGpuInfo } from "../../../src/ext/panel/webGpu";

const adapterWith = (shaderF16: boolean) => ({ features: { has: (n: string) => n === "shader-f16" && shaderF16 } });

describe("probeAdapter", () => {
  it("is unavailable when navigator.gpu is absent", async () => {
    expect(await probeAdapter(undefined)).toEqual({ available: false, shaderF16: false, adapter: "", isFallback: false });
  });

  it("is unavailable when requestAdapter yields null (gpu present, no usable adapter)", async () => {
    expect(await probeAdapter({ requestAdapter: vi.fn(async () => null) })).toEqual({ available: false, shaderF16: false, adapter: "", isFallback: false });
  });

  it("is unavailable when requestAdapter throws", async () => {
    expect(await probeAdapter({ requestAdapter: vi.fn(async () => { throw new Error("no gpu"); }) })).toEqual({
      available: false,
      shaderF16: false,
      adapter: "",
      isFallback: false,
    });
  });

  it("reports available + shaderF16 true when the adapter exposes shader-f16", async () => {
    expect(await probeAdapter({ requestAdapter: vi.fn(async () => adapterWith(true)) })).toEqual({
      available: true,
      shaderF16: true,
      adapter: "",
      isFallback: false,
    });
  });

  it("reports available + shaderF16 false when the adapter lacks shader-f16", async () => {
    expect(await probeAdapter({ requestAdapter: vi.fn(async () => adapterWith(false)) })).toEqual({
      available: true,
      shaderF16: false,
      adapter: "",
      isFallback: false,
    });
  });

  it("treats a missing features set as no shader-f16", async () => {
    expect(await probeAdapter({ requestAdapter: vi.fn(async () => ({})) })).toEqual({ available: true, shaderF16: false, adapter: "", isFallback: false });
  });

  it("captures the adapter identity from adapter.info (software-renderer diagnostics)", async () => {
    const adapter = { features: { has: () => false }, info: { vendor: "mesa", architecture: "llvmpipe", description: "LLVM 17" } };
    expect(await probeAdapter({ requestAdapter: vi.fn(async () => adapter) })).toEqual({
      available: true,
      shaderF16: false,
      adapter: "mesa llvmpipe LLVM 17",
      isFallback: false,
    });
  });

  it("falls back to requestAdapterInfo() when adapter.info is absent (older API)", async () => {
    const adapter = { features: { has: () => false }, requestAdapterInfo: async () => ({ vendor: "nvidia", architecture: "ampere" }) };
    expect((await probeAdapter({ requestAdapter: vi.fn(async () => adapter) })).adapter).toBe("nvidia ampere");
  });

  it("captures isFallbackAdapter (Chrome's software renderer signal, hidden identity)", async () => {
    const adapter = { features: { has: () => false }, isFallbackAdapter: true }; // Chrome sanitizes info to empty
    expect(await probeAdapter({ requestAdapter: vi.fn(async () => adapter) })).toEqual({
      available: true,
      shaderF16: false,
      adapter: "",
      isFallback: true,
    });
  });
});

describe("webGpuInfo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is unavailable when navigator is undefined (non-DOM context)", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(await webGpuInfo()).toEqual({ available: false, shaderF16: false, adapter: "", isFallback: false });
  });

  it("is unavailable when navigator.gpu is absent", async () => {
    vi.stubGlobal("navigator", {});
    expect(await webGpuInfo()).toEqual({ available: false, shaderF16: false, adapter: "", isFallback: false });
  });

  it("delegates to the adapter probe when navigator.gpu is present", async () => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => adapterWith(true) } });
    expect(await webGpuInfo()).toEqual({ available: true, shaderF16: true, adapter: "", isFallback: false });
  });
});
