import browser from "webextension-polyfill";
import { persistReview, ReviewResult } from "../../core/fill/persistReview";
import { classify } from "../../core/fill/matcher";
import { Vault } from "../../core/details/vault";
import { ActiveContext } from "../../core/details/activeContext";
import { LabelRegistry } from "../../core/labels/labelRegistry";
import { OpenAICompatibleAdapter } from "../../core/planner/openAICompatibleAdapter";
import { WebLlmModelClient } from "../../core/planner/webLlmModelClient";
import { DomFormSource } from "../../core/form/domFormSource";
import { FilledEntry, SubmitSpec } from "../../core/types";
import { MessagingPageBridge } from "../page/messagingPageBridge";
import { BrowserStorageBackend } from "../storage/browserStorageBackend";
import { createVaultStore, LocalVaultStore } from "../storage/vaultStore";
import { EncryptedVaultStore, VaultLockedError, createSessionKeyStore } from "../storage/encryptedVaultStore";
import { loadEncryptionConfig, saveEncryptionConfig } from "../storage/encryptionConfig";
import { createPasswordPrompt } from "./passwordPrompt";
import { renderEncryptionSettings } from "./encryptionSettingsView";
import { PENDING_TAB_STORAGE_KEY } from "./pendingTab";
import { loadConfig } from "./panelConfig";
import { ensureContentScript, EnsureDeps } from "./ensureContentScript";
import { pickTargetTab, TabPickDeps } from "./pickTargetTab";
import { describeError } from "./describeError";
import { createWebLlmEngine } from "./webLlmEngine";
import { webGpuInfo } from "./webGpu";
import { diagnoseGpu } from "./gpuDiagnostics";
import { pickModelId, WEBLLM_MODEL_F32 } from "./webLlmModels";
import { OffscreenChatEngine } from "./offscreenModelClient";
import { isModelProgress, PrepareModelReply, OffscreenStatusReply } from "../offscreen/offscreenMessages";
import { ModelProvider } from "./modelProvider";
import { renderSettings, renderLabelRegistry } from "./settingsView";
import { renderTabs, TabSpec } from "./settingsTabs";
import { Unlearn } from "./resolveReviewEntry";
import { renderProgressive, renderReview } from "./reviewView";
import { hostnameOf, partitionRestorable } from "./restoreTabs";
import { TabSessionManager } from "./tabSessionManager";
import { TabReviewStore, SerializedTabReview } from "./tabReviewStore";
import { createModelMutex } from "./modelMutex";
import { createMutex } from "./mutex";

// A fill waits up to this long for the on-device model to load before falling
// back to the endpoint, so a stalled download can't block filling indefinitely.
const ON_DEVICE_WAIT_MS = 120_000;

// A tab with at least this many fillable fields is "form-heavy" enough to preload
// the on-device model for (so it's warm before the user asks to fill).
const FORM_FIELD_THRESHOLD = 2;

// Browser-API adapters injected into the tab helpers — hoisted so the same literal
// isn't rebuilt at every call site.
const tabAccess: TabPickDeps = {
  getTab: (id) => browser.tabs.get(id),
  queryActiveTab: async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0],
};
const contentScriptAccess: EnsureDeps = {
  sendMessage: (id, m) => browser.tabs.sendMessage(id, m),
  executeScript: (o) => browser.scripting.executeScript(o),
};

/** Best-effort count of fillable fields on the active tab, for deciding whether
 *  to preload the model. Any failure (no tab, unreachable page) yields 0. */
async function activeTabFieldCount(): Promise<number> {
  try {
    const target = await pickTargetTab(undefined, tabAccess);
    if (!target) return 0;
    await ensureContentScript(target.id, contentScriptAccess);
    const count = await browser.tabs.sendMessage(target.id, { action: "fieldCount", args: [] });
    return typeof count === "number" ? count : 0;
  } catch {
    return 0;
  }
}

async function consumePendingTabId(): Promise<number | undefined> {
  try {
    const stored = await browser.storage.session.get(PENDING_TAB_STORAGE_KEY);
    const tabId = stored[PENDING_TAB_STORAGE_KEY];
    if (typeof tabId !== "number") return undefined;
    await browser.storage.session.remove(PENDING_TAB_STORAGE_KEY);
    return tabId;
  } catch {
    return undefined;
  }
}

interface OnDeviceModelInputs {
  modelId: HTMLInputElement;
  loadButton: HTMLButtonElement;
}

function renderOnDeviceModel(root: HTMLElement): OnDeviceModelInputs {
  const section = document.createElement("div");
  section.id = "on-device-model";

  const modelIdLabel = document.createElement("label");
  modelIdLabel.textContent = "Model";
  const modelId = document.createElement("input");
  modelId.type = "text";
  modelId.id = "webllm-model-id";
  modelId.value = WEBLLM_MODEL_F32; // safe default; upgraded to f16 if the GPU supports it
  modelIdLabel.appendChild(modelId);

  const loadButton = document.createElement("button");
  loadButton.id = "webllm-load-button";
  loadButton.textContent = "Load on-device model";

  // Starts disabled until an adapter is confirmed (Firefox local path).
  loadButton.disabled = true;

  section.appendChild(modelIdLabel);
  section.appendChild(loadButton);
  root.appendChild(section);

  return { modelId, loadButton };
}

/** A fixed bottom footer for all status/loading text — one line for the active
 *  tab's run status, one (muted) for the shared model's load progress, one for
 *  the GPU diagnostic. Fixed so transient status never reflows the review. */
function renderStatusFooter(): { workStatus: HTMLElement; modelStatus: HTMLElement; gpuStatus: HTMLElement } {
  const footer = document.createElement("div");
  footer.id = "status-footer";
  const workStatus = document.createElement("div");
  workStatus.className = "vof-work-status";
  const modelStatus = document.createElement("div");
  modelStatus.className = "vof-model-status";
  const gpuStatus = document.createElement("div");
  gpuStatus.className = "vof-gpu-status";
  footer.append(workStatus, modelStatus, gpuStatus);
  document.body.appendChild(footer);
  // Show the divider only when there's text (so an idle footer is invisible).
  new MutationObserver(() => {
    footer.classList.toggle("has-status", !!(workStatus.textContent || modelStatus.textContent || gpuStatus.textContent));
  }).observe(footer, { subtree: true, childList: true, characterData: true });
  // Reserve exactly the footer's height as body padding so a multi-line load
  // message grows the reserved space instead of occluding the review's buttons.
  new ResizeObserver(() => {
    document.body.style.paddingBottom = `${footer.offsetHeight}px`;
  }).observe(footer);
  return { workStatus, modelStatus, gpuStatus };
}

/** One tab's review workspace. Each tab keeps its own detached DOM (status +
 *  review rows), form source, and latest entries, so several forms can be
 *  mid-review at once; only the active tab's `root` is mounted on screen. `busy`
 *  is the per-tab guard shared by read and fill so they can't overlap on a tab
 *  (reads on DIFFERENT tabs still run — they queue only on the shared model). */
interface TabSession {
  tabId: number;
  domain: string;
  root: HTMLElement;
  reviewEl: HTMLElement;
  // The tab's latest run status ("Reading form…", "Filled & saved.", …). Rendered
  // in the global fixed footer when this tab is active, so it never shifts the
  // review content.
  status: string;
  source?: DomFormSource;
  entries?: FilledEntry[];
  submit?: SubmitSpec;
  busy: boolean;
  // Set when the tab navigated/closed while a read or fill was in flight; the
  // in-flight flow then bails instead of re-persisting a review with dead
  // elementIds (see persistSession).
  stale: boolean;
}

async function main(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("panel root element missing");
  root.innerHTML = "";

  // Saved endpoint settings (panelConfig) are the last-resort fallback when the
  // on-device model is unavailable; there is no UI for them — usually unconfigured.
  const savedConfig = await loadConfig(browser.storage.local);

  // The on-device model is always used: on Chrome it runs in a background offscreen
  // document; on Firefox (no offscreen API) it loads in the panel; the endpoint is
  // only a last-resort fallback if WebGPU is unavailable. All that logic lives in
  // ModelProvider (built below) — here we just inject the environment and wire its
  // UI callbacks to the footer + on-device controls.
  const { modelId: webllmModelId, loadButton: webllmLoadButton } = renderOnDeviceModel(root);
  // All status/loading text lives in a fixed footer so it never reflows the review.
  const { workStatus: workStatusEl, modelStatus: webllmOutput, gpuStatus: gpuStatusEl } = renderStatusFooter();

  // GPU health diagnostic: on-device inference needs a hardware WebGPU adapter; a
  // software renderer (or no WebGPU) makes it unusably slow. Probe once and warn
  // in the footer with the flags to fix it. Runs in the panel (which has its own
  // navigator.gpu) independent of where the model actually runs.
  void (async () => {
    const info = await webGpuInfo(); // never rejects — returns UNAVAILABLE on any failure
    const diag = diagnoseGpu(info, navigator.userAgent.includes("Firefox") ? "firefox" : "chromium");
    gpuStatusEl.textContent = diag.text;
    gpuStatusEl.classList.toggle("warn", diag.warn);
  })();

  const modelProvider = new ModelProvider({
    prepareBackend: () =>
      browser.runtime
        .sendMessage({ kind: "vof:prepareModel" })
        .then((r) => (r as PrepareModelReply | undefined)?.backend ?? "local"),
    warmOffscreen: () => browser.runtime.sendMessage({ kind: "vof:warmModel" }).then(() => {}),
    offscreenStatus: () =>
      browser.runtime.sendMessage({ kind: "vof:offscreen:status" }).then((s) => s as OffscreenStatusReply | undefined),
    onOffscreenProgress: (listener) => {
      browser.runtime.onMessage.addListener((message: unknown) => {
        if (isModelProgress(message)) listener(message);
        return undefined;
      });
    },
    createOffscreenClient: () => new WebLlmModelClient(new OffscreenChatEngine()),
    loadLocalEngine: async (modelId, onProgress) => {
      const engine = await createWebLlmEngine(modelId, onProgress);
      return { client: new WebLlmModelClient(engine), dispose: engine.dispose };
    },
    createEndpointClient: () =>
      new OpenAICompatibleAdapter({ baseUrl: savedConfig.baseUrl, model: savedConfig.model, apiKey: savedConfig.apiKey }),
    webGpuInfo,
    pickModelId,
    getModelId: () => webllmModelId.value,
    shouldPreload: async () => (await activeTabFieldCount()) >= FORM_FIELD_THRESHOLD,
    timeoutMs: ON_DEVICE_WAIT_MS,
    ui: {
      status: (text) => { webllmOutput.textContent = text; },
      onOffscreenBackend: () => {
        webllmLoadButton.style.display = "none";
        // The model-id input is dead on Chrome (selection happens in the offscreen
        // doc), so hide its label too.
        if (webllmModelId.parentElement) webllmModelId.parentElement.style.display = "none";
      },
      onLocalBackend: (modelId) => {
        webllmModelId.value = modelId;
        webllmLoadButton.disabled = false;
      },
      onLocalLoadStart: () => { webllmLoadButton.disabled = true; },
      onLocalLoadEnd: (succeeded) => {
        webllmLoadButton.disabled = false;
        if (succeeded) webllmLoadButton.textContent = "Reload on-device model";
      },
    },
  });

  // Reload forces a fresh local load (e.g. to switch model ids); the provider reads
  // the current model-id input via getModelId.
  webllmLoadButton.addEventListener("click", () => modelProvider.reload());
  void modelProvider.enable(); // always on — rely fully on the local model

  // Reads + classifies the ACTIVE tab into that tab's review (a fresh read each
  // click — it resets and re-reads). Filling happens from the review's Fill /
  // Fill & Submit buttons, so this is "Read", not "Fill". One button always acts
  // on whichever tab is showing; several tabs can each hold a live review.
  const fillButton = document.createElement("button");
  fillButton.id = "fill-button";
  fillButton.textContent = "Read this Page";
  root.appendChild(fillButton);

  // The mount point: shows the active tab's review, or a placeholder when that
  // tab has none yet. Each tab's review lives in its own detached DOM (a
  // TabSession.root) that we swap in here as the active tab changes.
  const reviewMount = document.createElement("div");
  reviewMount.id = "review";
  root.appendChild(reviewMount);
  const placeholder = document.createElement("div");
  placeholder.className = "vof-placeholder";
  placeholder.textContent = "Read this Page to review the form in the current tab.";

  const storage = new BrowserStorageBackend(browser.storage.local);
  // At-rest encryption wraps the LOCAL store (the native-companion path owns its
  // own storage and is out of scope). The unlock prompt renders into a host at the
  // top of the panel; the store calls it when it needs the password.
  const unlockHost = document.createElement("div");
  unlockHost.id = "vault-unlock";
  unlockHost.hidden = true;
  root.insertBefore(unlockHost, root.firstChild);
  const encStore = new EncryptedVaultStore({
    inner: new LocalVaultStore(storage),
    raw: storage,
    config: {
      load: () => loadEncryptionConfig(browser.storage.local),
      save: (cfg) => saveEncryptionConfig(browser.storage.local, cfg),
    },
    prompt: createPasswordPrompt(unlockHost),
    // storage.session only (never storage.local) so a cached key can't outlive the
    // browser session; undefined on old Firefox → session mode prompts each open.
    session: createSessionKeyStore(browser.storage.session),
  });
  const vaultStore = await createVaultStore({ local: encStore });
  const localEncryptionActive = vaultStore === encStore;

  let vault: Vault;
  try {
    vault = await vaultStore.loadVault();
  } catch (err) {
    // Locked (user cancelled the unlock): show a locked screen rather than a crash
    // or an empty vault. Crucially we return BEFORE any saveVault, so a plaintext
    // write can't clobber the encrypted blob (the no-clobber guard also refuses it).
    if (err instanceof VaultLockedError) {
      const locked = document.createElement("div");
      locked.className = "vof-locked";
      const msg = document.createElement("p");
      msg.textContent = "Your vault is locked. Enter your password to unlock it.";
      const btn = document.createElement("button");
      btn.textContent = "Unlock vault";
      btn.addEventListener("click", () => location.reload());
      locked.append(msg, btn);
      root.appendChild(locked);
      return;
    }
    throw err;
  }
  // ActiveContext (volatile details) lives in session storage so temporary
  // values persist across sites within a browser session but not across restarts.
  // storage.session is unavailable on older Firefox MV3 — fall back to local
  // there (volatile details then persist across restarts, an acceptable degrade).
  const sessionStore = new BrowserStorageBackend(browser.storage.session ?? browser.storage.local);
  const ctx = await sessionStore.loadActiveContext().catch(() => new ActiveContext());
  // Durable vocabulary memory: labels the model invented for novel fields, kept so
  // it reuses them next site (open-set convergence) even when their value wasn't
  // saved. Non-sensitive (label names + question phrasings, no values).
  const labelRegistry = await storage.loadLabelRegistry().catch(() => new LabelRegistry());

  // Per-tab reviews persist to session storage so open reviews survive closing
  // and reopening the panel (within the browser session).
  const tabReviewStore = new TabReviewStore(browser.storage.session ?? browser.storage.local);
  // The shared model handles one generation at a time; serialize labeling across
  // tabs so concurrent reads queue instead of colliding on the one engine.
  const modelMutex = createModelMutex();
  // Fills mutate the shared vault/ActiveContext and save them wholesale; with
  // per-tab (not global) locking, two tabs could Fill at once and lose an update
  // when their saves land out of order. Serialize the commit critical-section.
  const commitMutex = createMutex();

  const syncFillButton = (session: TabSession | undefined): void => {
    fillButton.disabled = session?.busy ?? false;
  };
  const refreshButton = (session: TabSession): void => {
    if (sessions.isActive(session.tabId)) syncFillButton(session);
  };

  const createSession = (tabId: number): TabSession => {
    const reviewEl = document.createElement("div");
    reviewEl.className = "vof-review";
    return { tabId, domain: "", root: reviewEl, reviewEl, status: "", busy: false, stale: false };
  };

  const sessions = new TabSessionManager<TabSession>({
    create: createSession,
    mount: (s) => { reviewMount.replaceChildren(s.root); syncFillButton(s); workStatusEl.textContent = s.status; },
    // Detach on unmount so closing the active tab clears the view even if no
    // other tab is activated afterward (mount also replaces, so this is a no-op
    // during a normal tab switch).
    unmount: (s) => s.root.remove(),
    onEmpty: () => { reviewMount.replaceChildren(placeholder); syncFillButton(undefined); workStatusEl.textContent = ""; },
  });

  // Set a tab's run status; reflect it in the footer only when that tab is active
  // (a background tab finishing a read must not overwrite the shown status).
  const setStatus = (session: TabSession, text: string): void => {
    session.status = text;
    if (sessions.isActive(session.tabId)) workStatusEl.textContent = text;
  };

  const persistSession = (session: TabSession): Promise<void> => {
    // Skip a session whose tab navigated/closed mid-flight — its entries are now
    // stale, and dropSession already removed its blob; re-saving would resurrect it.
    if (session.stale || !session.entries) return Promise.resolve();
    return tabReviewStore
      .save(session.tabId, {
        domain: session.domain,
        entries: session.entries,
        submit: session.submit,
        status: session.status || undefined,
      })
      .catch(() => {});
  };

  // Settings page: two sections — the saved vault (labels, values/variants,
  // aliases, where a user fixes a wrong learned mapping) and the learned label
  // vocabulary (the model's invented labels, where a user prunes a junk one).
  const settingsButton = document.createElement("button");
  settingsButton.id = "settings-button";
  settingsButton.textContent = "⚙ Settings";
  const settingsContainer = document.createElement("div");
  settingsContainer.id = "settings";
  settingsContainer.style.display = "none";
  root.append(settingsButton, settingsContainer);

  // Settings pane: tabbed so the (potentially long) Saved values / Learned fields
  // lists each live in their own tab and don't bury the normal settings. Built once;
  // renderSettingsPage re-renders content into the persistent tab panels.
  const tabSpecs: TabSpec[] = [];
  // General holds the normal settings (encryption) — only when the local encrypted
  // store is active (not the native companion, which owns its own storage).
  if (localEncryptionActive) tabSpecs.push({ id: "general", label: "General" });
  tabSpecs.push({ id: "values", label: "Saved values" }, { id: "learned", label: "Learned fields" });
  const tabPanels = renderTabs(settingsContainer, tabSpecs);
  const valuesSection = tabPanels.values!;
  const registrySection = tabPanels.learned!;
  const encryptionSection = tabPanels.general; // undefined when the native store is active
  const renderSettingsPage = (): void => {
    renderSettings(valuesSection, vault, () => void vaultStore.saveVault(vault));
    renderLabelRegistry(registrySection, labelRegistry, () => void storage.saveLabelRegistry(labelRegistry));
    if (encryptionSection) {
      void renderEncryptionSettings(encryptionSection, {
        loadConfig: () => loadEncryptionConfig(browser.storage.local),
        enable: (password, mode) => encStore.enableEncryption(vault, password, mode),
        disable: async (password) => void (await encStore.disableEncryption(password)),
        setMode: (mode) => encStore.setUnlockMode(mode),
      });
    }
  };

  const onDeviceSection = document.getElementById("on-device-model");
  let settingsOpen = false;
  settingsButton.addEventListener("click", () => {
    settingsOpen = !settingsOpen;
    settingsContainer.style.display = settingsOpen ? "" : "none";
    // Hide the read/review + on-device chrome so the settings pane owns the view.
    for (const el of [fillButton, reviewMount, onDeviceSection]) {
      if (el) el.style.display = settingsOpen ? "none" : "";
    }
    settingsButton.textContent = settingsOpen ? "← Back" : "⚙ Settings";
    if (settingsOpen) renderSettingsPage();
  });

  // Render (or re-render) a tab's review into its own detached DOM from its
  // latest entries; Fill / Fill & Submit route back through applyReview.
  const wireReview = (session: TabSession): void =>
    renderReview(session.reviewEl, session.entries ?? [], (review, unlearn, submit) =>
      void applyReview(session, review, unlearn, submit),
    );

  // A filled entry becomes green (certain) after Fill, carrying its persisted
  // detail (so the tier badge / variants reflect what was saved).
  const greenify = (entries: FilledEntry[]): FilledEntry[] =>
    entries.map((e) => {
      if (e.value == null) return e; // not filled → unchanged (stays red/etc.)
      const label = e.detail?.canonicalLabel ?? e.field.label;
      const detail = (label ? vault.getByCanonical(label) ?? ctx.get(label) : undefined) ?? e.detail;
      return { ...e, confidence: "certain" as const, detail };
    });

  // Each review Fill / Fill & Submit click: persist to the vault, fill that tab's
  // page (+ submit), save, then re-render so filled fields go green and the
  // review stays a live, re-usable workspace. Operates on the tab's own session.
  async function applyReview(session: TabSession, review: ReviewResult, unlearn: Unlearn[], submit: boolean): Promise<void> {
    if (session.busy) return; // a read/apply is already in flight for this tab
    const source = session.source;
    if (!source) return;
    session.busy = true;
    refreshButton(session);
    try {
      // Mutate the shared stores synchronously (no interleaving possible), then do
      // the tab-local page I/O OUTSIDE any cross-tab lock so a hung content script
      // on this tab can't block another tab's Fill.
      for (const u of unlearn) {
        vault.removeAlias(u.label, u.alias);
        ctx.removeAlias(u.label, u.alias);
      }
      persistReview(review, vault, ctx, labelRegistry);
      // A restored session may point at a tab whose content script is gone; ensure
      // it's injected before staging (idempotent — a no-op if already present).
      await ensureContentScript(session.tabId, contentScriptAccess);
      await source.stage(review.entries);
      if (submit) await source.commit();
      // Serialize only the wholesale store writes across tabs so two Fills landing
      // at once can't clobber each other's snapshot (last-write-wins on the key).
      await commitMutex.run(async () => {
        await vaultStore.saveVault(vault);
        await sessionStore.saveActiveContext(ctx).catch(() => {});
        await storage.saveLabelRegistry(labelRegistry).catch(() => {});
      });
      setStatus(session, submit ? "Submitted." : "Filled & saved.");
      session.entries = greenify(review.entries);
      wireReview(session);
      await persistSession(session);
    } catch (err) {
      console.error("[[VAULTOFILL]] apply review failed:", err);
      setStatus(session, `Error: ${describeError(err)}`);
      session.entries = review.entries;
      wireReview(session); // re-enable the buttons to retry
    } finally {
      session.busy = false;
      refreshButton(session);
    }
  }

  async function runPipeline(explicitTabId?: number): Promise<void> {
    const target = await pickTargetTab(explicitTabId, tabAccess);
    if (!target) return; // no tab to read — nothing to show a status on
    const { id: tabId, domain } = target;

    const session = sessions.ensure(tabId);
    session.domain = domain;
    if (session.busy) return; // a read/apply is already in flight for this tab
    session.busy = true;
    // Reveal this tab's (possibly just-created) review if it's the one on screen.
    if (sessions.isActive(tabId)) sessions.activate(tabId);
    refreshButton(session);
    try {
      session.reviewEl.innerHTML = "";
      setStatus(session, `Connecting to page (tab ${tabId})…`);
      await ensureContentScript(tabId, contentScriptAccess);

      // Choose the model: the on-device model (offscreen on Chrome, local on
      // Firefox) once it's ready, with a backstop so a slow load can't block the
      // fill — past the timeout it falls back to the (usually unconfigured)
      // endpoint as a last resort.
      const { client: modelClient, onDevice } = await modelProvider.getClient({
        onPreparing: () => setStatus(session, "Preparing on-device model…"),
      });
      setStatus(session, onDevice ? "Reading form & labeling on-device…" : "Reading form…");
      const source = new DomFormSource({ page: new MessagingPageBridge(tabId, domain) });
      session.source = source;

      // Read + classify (progressive paint via onDeterministic), then render the
      // interactive, re-usable review. The model call is serialized across tabs
      // (modelMutex) so a second tab's read queues on the shared engine; the
      // deterministic paint still lands immediately. Filling happens per click.
      const schema = await source.getSchema();
      session.submit = schema.submit;
      const entries = await classify(
        schema.fields,
        vault,
        ctx,
        modelMutex.wrap(modelClient),
        (partial) => renderProgressive(session.reviewEl, schema.fields, partial),
        labelRegistry, // re-surface invented labels in the vocab
      );
      session.entries = entries;
      wireReview(session);
      setStatus(session, "Review, then Fill.");
      await persistSession(session);
    } catch (err) {
      console.error("[[VAULTOFILL]] fill failed:", err);
      setStatus(session, `Error: ${describeError(err)}`);
    } finally {
      session.busy = false;
      refreshButton(session);
    }
  }

  // --- Per-tab lifecycle: swap the shown review as the user switches tabs, and
  // restore reviews persisted for tabs still open in this window. ---
  const myWindowId = await browser.windows.getCurrent().then((w) => w.id).catch(() => undefined);
  // A tab's current domains by id (undefined = query failed, so callers skip
  // rather than treat it as "no tabs" and wipe state).
  const tabDomainsOf = async (query: Record<string, unknown>): Promise<Map<number, string> | undefined> => {
    try {
      const tabs = await browser.tabs.query(query);
      const domains = new Map<number, string>();
      for (const t of tabs) if (t.id !== undefined) domains.set(t.id, hostnameOf(t.url));
      return domains;
    } catch {
      return undefined;
    }
  };

  // Restore this window's tabs; prune against ALL windows' tabs (the persisted
  // blob is shared across every window's panel, so another window's live tabs
  // must not be pruned here). Skip both on a query failure so nothing is wiped.
  const myTabDomains = await tabDomainsOf({ currentWindow: true });
  const restored = await tabReviewStore.loadAll().catch(() => new Map<number, SerializedTabReview>());
  // partitionRestorable: only this window's still-open tabs restore; a tab that
  // navigated while the panel was closed (no onUpdated fired) has dead stored
  // elementIds, so it drops rather than rehydrating a review that only errors
  // on Fill. An undefined domain map (query failed) restores/drops nothing.
  const { restore, drop } = partitionRestorable(restored, myTabDomains ?? new Map());
  for (const tabId of drop) void tabReviewStore.remove(tabId).catch(() => {});
  for (const tabId of restore) {
    const review = restored.get(tabId)!;
    const session = sessions.ensure(tabId);
    session.domain = review.domain;
    session.submit = review.submit;
    session.entries = review.entries;
    session.source = new DomFormSource({
      page: new MessagingPageBridge(tabId, review.domain),
      schema: review.submit ? { fields: [], submit: review.submit } : undefined,
    });
    session.status = review.status ?? "";
    wireReview(session);
  }
  const allTabDomains = await tabDomainsOf({});
  if (allTabDomains) void tabReviewStore.pruneTo(allTabDomains.keys()).catch(() => {});

  // Drop a tab's review — its page changed or the tab closed, so its stored
  // elementIds/entries no longer match. If it's the shown tab, fall back to the
  // placeholder.
  const dropSession = (tabId: number): void => {
    const wasActive = sessions.isActive(tabId);
    const existing = sessions.get(tabId);
    if (existing) existing.stale = true; // an in-flight read/fill on it must not re-persist
    sessions.remove(tabId);
    void tabReviewStore.remove(tabId).catch(() => {});
    if (wasActive) sessions.activate(tabId); // no session now → placeholder
  };

  browser.tabs.onActivated.addListener((info) => {
    if (myWindowId !== undefined && info.windowId !== myWindowId) return;
    sessions.activate(info.tabId);
  });
  // Not window-filtered (unlike onActivated/onUpdated): a tabId is globally
  // unique, so whichever window's panel sees the close first should purge the
  // shared blob — and dropSession is idempotent for a tab this panel doesn't hold.
  browser.tabs.onRemoved.addListener((tabId) => dropSession(tabId));
  // A reload or full navigation replaces the document the review was read from,
  // so its stored elementIds no longer match — drop the session and let the user
  // re-read. `status === "loading"` marks a new document loading (reload/full
  // nav); it deliberately does NOT fire on hash/anchor changes, which keep the
  // DOM (and elementIds) intact, so those don't discard a valid review.
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (myWindowId !== undefined && tab.windowId !== myWindowId) return;
    if (changeInfo.status === "loading" && sessions.has(tabId)) dropSession(tabId);
  });

  fillButton.addEventListener("click", () => void runPipeline());

  // Show the currently-active tab's review (or the placeholder) on open.
  const initialActive = (await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0];
  if (initialActive?.id !== undefined) sessions.activate(initialActive.id);
  else reviewMount.replaceChildren(placeholder); // no active tab resolved — don't leave a blank pane

  // The backend setup above already form-aware-warms the model (offscreen warm or
  // local preload) when the active tab is form-heavy, so a fill has it ready.
  const pendingTabId = await consumePendingTabId();
  if (pendingTabId !== undefined) {
    // Auto-run the read the in-page prompt requested (runPipeline warms/waits).
    void runPipeline(pendingTabId);
  }
}

void main();
