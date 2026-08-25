import { describe, it, expect, vi } from "vitest";
import { ModelProvider, ModelProviderDeps, Backend, LoadedEngine } from "../../../src/ext/panel/modelProvider";
import { ModelProgressMsg } from "../../../src/ext/offscreen/offscreenMessages";
import { ModelClient } from "../../../src/core/planner/modelClient";

const mc = (name: string): ModelClient => ({ name, complete: vi.fn(async () => ({})) } as unknown as ModelClient);

const loading = (progress: number, text = "x"): ModelProgressMsg => ({ kind: "vof:modelProgress", status: "loading", progress, text });
const ready = (): ModelProgressMsg => ({ kind: "vof:modelProgress", status: "ready", progress: 1, text: "" });
const errored = (text = "boom"): ModelProgressMsg => ({ kind: "vof:modelProgress", status: "error", progress: 0, text });

function harness(overrides: Partial<ModelProviderDeps> = {}) {
  const offscreenClient = mc("offscreen");
  const localClient = mc("local");
  const endpointClient = mc("endpoint");
  const dispose = vi.fn();
  let currentModelId = "MODEL-ID";
  let listener: (m: ModelProgressMsg) => void = () => {};
  const ui = {
    status: vi.fn(),
    onOffscreenBackend: vi.fn(),
    onLocalBackend: vi.fn(),
    onLocalLoadStart: vi.fn(),
    onLocalLoadEnd: vi.fn(),
  };
  const deps: ModelProviderDeps = {
    prepareBackend: vi.fn(async (): Promise<Backend> => "local"),
    warmOffscreen: vi.fn(async () => {}),
    offscreenStatus: vi.fn(async () => undefined),
    onOffscreenProgress: (l) => { listener = l; },
    createOffscreenClient: vi.fn(() => offscreenClient),
    loadLocalEngine: vi.fn(async () => ({ client: localClient, dispose })),
    createEndpointClient: vi.fn(() => endpointClient),
    webGpuInfo: vi.fn(async () => ({ available: true, shaderF16: true })),
    pickModelId: vi.fn(() => "MODEL-ID"),
    getModelId: vi.fn(() => currentModelId),
    shouldPreload: vi.fn(async () => false),
    timeoutMs: 30,
    ui,
    ...overrides,
  };
  return {
    deps,
    ui,
    offscreenClient,
    localClient,
    endpointClient,
    dispose,
    setModelId: (id: string) => { currentModelId = id; },
    emit: (m: ModelProgressMsg) => listener(m),
  };
}

const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

describe("ModelProvider — offscreen backend (Chrome)", () => {
  it("sets up the offscreen client, hides the local UI, warms, and shows the warming status", async () => {
    const h = harness({ prepareBackend: vi.fn(async (): Promise<Backend> => "offscreen") });
    await new ModelProvider(h.deps).enable();
    expect(h.deps.createOffscreenClient).toHaveBeenCalled();
    expect(h.ui.onOffscreenBackend).toHaveBeenCalled();
    expect(h.deps.warmOffscreen).toHaveBeenCalled();
    expect(h.ui.status).toHaveBeenCalledWith("Warming the on-device model in the background…");
  });

  it("getClient returns the on-device client when the offscreen model reports ready", async () => {
    const h = harness({ prepareBackend: vi.fn(async (): Promise<Backend> => "offscreen"), offscreenStatus: vi.fn(async () => ({ ready: true, failed: false })) });
    const { client, onDevice } = await new ModelProvider(h.deps).getClient();
    expect(onDevice).toBe(true);
    expect(client).toBe(h.offscreenClient);
  });

  it("getClient falls back to the endpoint when the offscreen model has failed", async () => {
    const h = harness({ prepareBackend: vi.fn(async (): Promise<Backend> => "offscreen"), offscreenStatus: vi.fn(async () => ({ ready: false, failed: true })) });
    const { client, onDevice } = await new ModelProvider(h.deps).getClient();
    expect(onDevice).toBe(false);
    expect(client).toBe(h.endpointClient);
  });

  it("getClient resolves on-device when a ready broadcast arrives before the timeout", async () => {
    const h = harness({ prepareBackend: vi.fn(async (): Promise<Backend> => "offscreen"), offscreenStatus: vi.fn(async () => ({ ready: false, failed: false })) });
    const p = new ModelProvider(h.deps);
    const pending = p.getClient();
    h.emit(ready()); // simulate the offscreen doc broadcasting readiness
    const { client, onDevice } = await pending;
    expect(onDevice).toBe(true);
    expect(client).toBe(h.offscreenClient);
  });

  it("getClient falls back to the endpoint on timeout with no ready/failed signal", async () => {
    const h = harness({ prepareBackend: vi.fn(async (): Promise<Backend> => "offscreen"), offscreenStatus: vi.fn(async () => ({ ready: false, failed: false })), timeoutMs: 10 });
    const { client, onDevice } = await new ModelProvider(h.deps).getClient();
    expect(onDevice).toBe(false);
    expect(client).toBe(h.endpointClient);
  });

  it("paints the pulled offscreen state when the panel opened mid-load (missed the broadcast)", async () => {
    const h = harness({
      prepareBackend: vi.fn(async (): Promise<Backend> => "offscreen"),
      offscreenStatus: vi.fn(async () => ({ ready: false, failed: false, lastProgress: loading(0.3, "shards") })),
    });
    await new ModelProvider(h.deps).enable();
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget status pull run
    expect(h.ui.status).toHaveBeenLastCalledWith("Loading model in the background… 30% — shards");
  });

  it("the status pull still overrides a broadcast that arrived before backend setup (no stuck 'warming')", async () => {
    const h = harness({
      prepareBackend: vi.fn(async (): Promise<Backend> => "offscreen"),
      offscreenStatus: vi.fn(async () => ({ ready: false, failed: false, lastProgress: loading(0.6, "more") })),
    });
    const p = new ModelProvider(h.deps);
    h.emit(loading(0.1, "early")); // arrives during backend selection, before setupOffscreen repaints "warming…"
    await p.enable();
    await new Promise((r) => setTimeout(r, 0));
    // Without the sawBroadcast reset, the early broadcast would latch and the pull
    // would skip, leaving the line stuck. It should reflect the pulled state instead.
    expect(h.ui.status).toHaveBeenLastCalledWith("Loading model in the background… 60% — more");
  });
});

describe("ModelProvider — local backend (Firefox)", () => {
  it("sets up: picks the model id and enables the load button, without preloading a cold tab", async () => {
    const h = harness();
    await new ModelProvider(h.deps).enable();
    expect(h.ui.onLocalBackend).toHaveBeenCalledWith("MODEL-ID");
    expect(h.deps.loadLocalEngine).not.toHaveBeenCalled(); // shouldPreload = false
  });

  it("preloads the model when the active tab is form-heavy", async () => {
    const h = harness({ shouldPreload: vi.fn(async () => true) });
    await new ModelProvider(h.deps).enable();
    await tick();
    expect(h.deps.loadLocalEngine).toHaveBeenCalledWith("MODEL-ID", expect.any(Function));
  });

  it("getClient loads and returns the on-device client", async () => {
    const h = harness();
    const { client, onDevice } = await new ModelProvider(h.deps).getClient();
    expect(h.deps.loadLocalEngine).toHaveBeenCalledWith("MODEL-ID", expect.any(Function));
    expect(onDevice).toBe(true);
    expect(client).toBe(h.localClient);
    expect(h.ui.onLocalLoadEnd).toHaveBeenCalledWith(true);
  });

  it("stays endpoint-only when WebGPU is unavailable (no load, no 'preparing')", async () => {
    const h = harness({ webGpuInfo: vi.fn(async () => ({ available: false, shaderF16: false })) });
    const onPreparing = vi.fn();
    const { client, onDevice } = await new ModelProvider(h.deps).getClient({ onPreparing });
    expect(onDevice).toBe(false);
    expect(client).toBe(h.endpointClient);
    expect(h.deps.loadLocalEngine).not.toHaveBeenCalled();
    expect(onPreparing).not.toHaveBeenCalled();
  });

  it("falls back to the endpoint when the load exceeds the timeout", async () => {
    const h = harness({ timeoutMs: 10, loadLocalEngine: vi.fn(() => new Promise<LoadedEngine>(() => {})) }); // never resolves
    const { client, onDevice } = await new ModelProvider(h.deps).getClient();
    expect(onDevice).toBe(false);
    expect(client).toBe(h.endpointClient);
  });

  it("reload disposes the old engine and reloads under the current (edited) model id", async () => {
    const h = harness();
    const p = new ModelProvider(h.deps);
    await p.getClient(); // first load — captures dispose
    h.setModelId("NEW-ID"); // user edited the model-id input
    p.reload();
    await tick();
    expect(h.dispose).toHaveBeenCalled();
    expect(h.deps.loadLocalEngine).toHaveBeenLastCalledWith("NEW-ID", expect.any(Function));
  });

  it("first load honors a user-edited model id (not just the initial pick)", async () => {
    const h = harness();
    h.setModelId("EDITED-ID"); // input edited before any fill
    await new ModelProvider(h.deps).getClient();
    expect(h.deps.loadLocalEngine).toHaveBeenCalledWith("EDITED-ID", expect.any(Function));
  });

  it("warns and still sets up local when the GPU lacks shader-f16", async () => {
    const h = harness({ webGpuInfo: vi.fn(async () => ({ available: true, shaderF16: false })) });
    await new ModelProvider(h.deps).enable();
    expect(h.ui.onLocalBackend).toHaveBeenCalled();
    expect(h.ui.status).toHaveBeenCalledWith("This GPU lacks shader-f16; using the f32 model.");
  });

  it("on a local load failure, re-enables the button without relabeling and shows the error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ loadLocalEngine: vi.fn(async () => { throw new Error("kaput"); }) });
    const { client, onDevice } = await new ModelProvider(h.deps).getClient();
    expect(onDevice).toBe(false); // failed load → endpoint
    expect(client).toBe(h.endpointClient);
    expect(h.ui.onLocalLoadStart).toHaveBeenCalled();
    expect(h.ui.onLocalLoadEnd).toHaveBeenCalledWith(false); // NOT relabeled to "Reload"
    expect(h.ui.status).toHaveBeenCalledWith(expect.stringContaining("❌"));
    errSpy.mockRestore();
  });

  it("fires onPreparing on the local on-device path", async () => {
    const h = harness();
    const onPreparing = vi.fn();
    await new ModelProvider(h.deps).getClient({ onPreparing });
    expect(onPreparing).toHaveBeenCalled();
  });

  it("enable() runs setup once even when called repeatedly", async () => {
    const h = harness();
    const p = new ModelProvider(h.deps);
    await Promise.all([p.enable(), p.enable()]);
    await p.enable();
    expect(h.deps.prepareBackend).toHaveBeenCalledTimes(1);
    expect(h.deps.webGpuInfo).toHaveBeenCalledTimes(1);
  });
});

describe("ModelProvider — progress rendering & preparing hook", () => {
  it("renders loading percentage, clears on ready, shows error text", () => {
    const h = harness();
    new ModelProvider(h.deps); // registers the progress listener
    h.emit(loading(0.5, "shards"));
    expect(h.ui.status).toHaveBeenLastCalledWith("Loading model in the background… 50% — shards");
    h.emit(ready());
    expect(h.ui.status).toHaveBeenLastCalledWith("");
    h.emit(errored("nope"));
    expect(h.ui.status).toHaveBeenLastCalledWith("nope");
  });

  it("fires onPreparing before waiting on the on-device model", async () => {
    const h = harness({ prepareBackend: vi.fn(async (): Promise<Backend> => "offscreen"), offscreenStatus: vi.fn(async () => ({ ready: true, failed: false })) });
    const onPreparing = vi.fn();
    await new ModelProvider(h.deps).getClient({ onPreparing });
    expect(onPreparing).toHaveBeenCalled();
  });
});
