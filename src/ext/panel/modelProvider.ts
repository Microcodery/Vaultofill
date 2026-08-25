import { ModelClient } from "../../core/planner/modelClient";
import { ModelProgressMsg, OffscreenStatusReply } from "../offscreen/offscreenMessages";
import { raceReadiness } from "./onDeviceReadiness";
import { pickOpenProgress } from "./modelStatus";
import { describeError } from "./describeError";

export type Backend = "offscreen" | "local";

/** A loaded in-panel (Firefox) engine and its teardown (frees GPU VRAM). `dispose`
 *  may be absent when the engine exposes no teardown. */
export interface LoadedEngine {
  client: ModelClient;
  dispose: (() => void) | undefined;
}

/** UI hooks the panel wires to the DOM — the provider never touches the DOM, so
 *  it stays unit-testable. */
export interface ModelProviderUi {
  /** The footer model-status line (progress / errors / "" to clear). */
  status(text: string): void;
  /** Offscreen backend chosen (Chrome): the model loads in the background, so the
   *  panel hides the manual load button and the (dead) model-id input. */
  onOffscreenBackend(): void;
  /** Local backend ready (Firefox): show the picked model id and enable the manual
   *  load button. */
  onLocalBackend(modelId: string): void;
  /** A local load started: disable the load button. */
  onLocalLoadStart(): void;
  /** A local load finished: re-enable the load button; relabel it to "reload" only
   *  on success (a failed load leaves the original label). */
  onLocalLoadEnd(succeeded: boolean): void;
}

/** Everything the provider needs from its environment — all injected so the
 *  provider is DOM-free and testable with fakes. */
export interface ModelProviderDeps {
  /** Ask the background which backend to use (offscreen on Chrome, local on
   *  Firefox); this should already default to "local" on any failure. */
  prepareBackend: () => Promise<Backend>;
  /** Tell the offscreen document to start/continue warming. */
  warmOffscreen: () => Promise<void>;
  /** The offscreen model's current state — used to catch a warm we missed (the
   *  content script may have started it before the panel opened). */
  offscreenStatus: () => Promise<OffscreenStatusReply | undefined>;
  /** Register a listener for offscreen progress broadcasts (already filtered to
   *  ModelProgressMsg by the caller). */
  onOffscreenProgress: (listener: (msg: ModelProgressMsg) => void) => void;
  /** The client that routes chats to the offscreen document. */
  createOffscreenClient: () => ModelClient;
  /** Load the in-panel engine (Firefox); reports progress; returns a disposable
   *  client. */
  loadLocalEngine: (modelId: string, onProgress: (text: string, progress: number) => void) => Promise<LoadedEngine>;
  /** Last-resort endpoint client (built from the panel's config inputs). */
  createEndpointClient: () => ModelClient;
  /** WebGPU capability for the local path. */
  webGpuInfo: () => Promise<{ available: boolean; shaderF16: boolean }>;
  /** Choose the local model id from the GPU's shader-f16 support. */
  pickModelId: (shaderF16: boolean) => string;
  /** The model id to load right now — read at load time so a user-edited selection
   *  (the panel's model-id input) is honored, not just the initial pick. */
  getModelId: () => string;
  /** True if the active tab is form-heavy enough to preload the model now. */
  shouldPreload: () => Promise<boolean>;
  /** How long a fill waits for the on-device model before falling back. */
  timeoutMs: number;
  ui: ModelProviderUi;
}

const WARMING_STATUS = "Warming the on-device model in the background…";

/**
 * Owns the on-device model backend: selection (offscreen on Chrome, in-panel on
 * Firefox), warming, readiness, the local load/reload lifecycle, and the fill-time
 * choice of on-device vs a last-resort endpoint client. Extracted from the panel so
 * this behavior-critical logic is isolated and testable; the panel keeps only the
 * DOM wiring (via ModelProviderUi) and injects the environment.
 */
export class ModelProvider {
  private backend: Backend = "local";
  private onDeviceClient: ModelClient | undefined;
  private localWebGpu = false; // Firefox local path: a usable WebGPU adapter was found
  private enablePromise: Promise<void> | undefined;
  private localLoad: Promise<void> | undefined;
  private disposeLocal: (() => void) | undefined;
  private sawBroadcast = false; // an offscreen progress broadcast has taken over the status
  private readonly resolveReady: () => void;
  private readonly resolveFailed: () => void;
  private readonly whenReady: Promise<void>;
  private readonly whenFailed: Promise<void>;

  constructor(private readonly deps: ModelProviderDeps) {
    let rReady!: () => void;
    let rFailed!: () => void;
    this.whenReady = new Promise<void>((r) => { rReady = r; });
    this.whenFailed = new Promise<void>((r) => { rFailed = r; });
    this.resolveReady = rReady;
    this.resolveFailed = rFailed;
    deps.onOffscreenProgress((msg) => this.renderProgress(msg));
  }

  // Paint one offscreen-model progress message + drive the readiness signals.
  // `ready`/`failed` are authoritative; `loading` only updates the percentage.
  private renderProgress(msg: ModelProgressMsg): void {
    this.sawBroadcast = true;
    if (msg.status === "loading") {
      this.deps.ui.status(`Loading model in the background… ${Math.round(msg.progress * 100)}% — ${msg.text}`);
    } else if (msg.status === "ready") {
      this.deps.ui.status(""); // done — clear; only show status while loading
      this.resolveReady();
    } else {
      this.deps.ui.status(msg.text); // error / unavailable → endpoint fallback
      this.resolveFailed();
    }
  }

  /** Pick the backend and set it up. Memoized so it runs once. */
  enable(): Promise<void> {
    if (!this.enablePromise) {
      this.enablePromise = this.deps
        .prepareBackend()
        .catch(() => "local" as const)
        .then((b) => {
          this.backend = b;
          return b === "offscreen" ? this.setupOffscreen() : this.setupLocal();
        });
    }
    return this.enablePromise;
  }

  private setupOffscreen(): void {
    // Inference runs in the background offscreen document; the panel just routes
    // chats to it and reflects its broadcast progress. Loading is automatic, so the
    // manual load button is hidden.
    this.onDeviceClient = this.deps.createOffscreenClient();
    this.deps.ui.onOffscreenBackend();
    this.deps.ui.status(WARMING_STATUS);
    // Only a broadcast AFTER this "warming…" repaint should suppress the status pull
    // below — mirrors the old `textContent !== WARMING_STATUS` guard, so an early
    // broadcast (during backend selection) doesn't wrongly leave the line stuck.
    this.sawBroadcast = false;
    // Warm now (the content script also warms on form pages; this covers the panel
    // being opened on an already-loaded form tab).
    void this.deps.warmOffscreen().catch(() => {});
    // The warm may already be underway (the content script started it before the
    // panel opened), so we missed its early broadcasts — pull the live state once so
    // we show real progress instead of a stuck "warming…", unless a broadcast has
    // already taken over.
    void (async () => {
      const status = await this.deps.offscreenStatus().catch(() => undefined);
      if (!status || this.sawBroadcast) return;
      const open = pickOpenProgress(status);
      if (open) this.renderProgress(open);
    })();
  }

  private async setupLocal(): Promise<void> {
    // The footer GPU diagnostic owns WebGPU-health messaging, so this path stays
    // silent on that and just wires up the model.
    const { available, shaderF16 } = await this.deps.webGpuInfo();
    if (!available) return; // no usable adapter → endpoint-only
    this.localWebGpu = true;
    this.deps.ui.onLocalBackend(this.deps.pickModelId(shaderF16));
    if (!shaderF16) this.deps.ui.status("This GPU lacks shader-f16; using the f32 model.");
    // Form-aware preload: warm now if the active tab is form-heavy.
    if (await this.deps.shouldPreload()) void this.loadLocal();
  }

  private loadLocal(): Promise<void> {
    if (this.onDeviceClient) return Promise.resolve(); // already loaded — don't re-download
    if (this.localLoad) return this.localLoad;
    this.localLoad = (async () => {
      this.deps.ui.onLocalLoadStart();
      this.deps.ui.status("Loading model… (first run downloads the weights, then caches them)");
      try {
        const { client, dispose } = await this.deps.loadLocalEngine(this.deps.getModelId(), (text, progress) => {
          this.deps.ui.status(`Loading model… ${Math.round(progress * 100)}% — ${text}`);
        });
        this.disposeLocal = dispose;
        this.onDeviceClient = client;
        this.resolveReady();
        this.deps.ui.status(""); // done — clear; only show status while loading
        this.deps.ui.onLocalLoadEnd(true);
      } catch (err) {
        console.error("[[VAULTOFILL]] on-device model load failed:", err);
        this.deps.ui.status(`❌ ${describeError(err)}`);
        this.deps.ui.onLocalLoadEnd(false);
      } finally {
        this.localLoad = undefined;
      }
    })();
    return this.localLoad;
  }

  /** Force a fresh local load under the current model id (e.g. to switch models);
   *  tear down the old engine first so two ~2 GB engines don't coexist. No-op unless
   *  the local backend is active (the offscreen backend loads in the background). */
  reload(): void {
    if (this.backend !== "local") return;
    this.disposeLocal?.();
    this.disposeLocal = undefined;
    this.onDeviceClient = undefined;
    void this.loadLocal();
  }

  // Ensure the background (offscreen) model is warming, then resolve true once it
  // reports ready — querying its current state in case we missed the one-shot
  // broadcast — false if it has failed/timed out, so the fill uses the endpoint.
  private async offscreenReadyWithin(ms: number): Promise<boolean> {
    await this.deps.warmOffscreen().catch(() => {});
    const status = await this.deps.offscreenStatus().catch(() => undefined);
    if (status?.ready) return true;
    if (status?.failed) return false; // already failed (e.g. WebGPU unavailable) → endpoint now
    return raceReadiness(this.whenReady, this.whenFailed, ms);
  }

  /**
   * The on-device client if it's ready within the timeout, else a last-resort
   * endpoint client. `onDevice` says which was chosen (for the caller's status).
   * `hooks.onPreparing` fires only when we're actually going to wait for the
   * on-device model (so the caller can show "Preparing…" without lying on the
   * endpoint-only path).
   */
  async getClient(hooks: { onPreparing?: () => void } = {}): Promise<{ client: ModelClient; onDevice: boolean }> {
    await this.enable();
    if (this.backend === "offscreen") {
      hooks.onPreparing?.();
      const ready = await this.offscreenReadyWithin(this.deps.timeoutMs);
      const client = ready && this.onDeviceClient ? this.onDeviceClient : this.deps.createEndpointClient();
      return { client, onDevice: client === this.onDeviceClient };
    }
    if (this.localWebGpu) {
      hooks.onPreparing?.();
      // Backstop so a slow load can't block the fill: past the timeout, fall back.
      await Promise.race([this.loadLocal(), new Promise<void>((r) => setTimeout(r, this.deps.timeoutMs))]);
      const client = this.onDeviceClient ?? this.deps.createEndpointClient();
      return { client, onDevice: client === this.onDeviceClient };
    }
    return { client: this.deps.createEndpointClient(), onDevice: false };
  }
}
