# Vaultofill

A browser extension that fills web forms with your data — **deterministically wherever possible**, using AI only at the edges.

## The idea

The center of gravity is a canonical field schema: a **deterministic DOM sweep** reads the page's form into a list of `{question, elementId, control}` fields — labels, aria, radio/checkbox groups, selects — with no AI involved.

AI is confined to **exactly one job**: mapping a field's question to a **canonical label** (`EMAIL`, `START_DATE`, …) when no deterministic match exists. One on-device LLM call per form labels every unknown question; it can reuse a known label or **invent a new one** for a field type it's never seen, which Vaultofill remembers so the same concept converges to the same label across sites. Everything else — lookup, fill, submit — is deterministic.

## Two ideas that make it trustworthy

**1. A canonical-label vault.** Each stored detail is tagged on two orthogonal axes:

| Axis | Values | Governs |
|---|---|---|
| **Sensitivity** | `public` · `private` · `sensitive` | the Gate + what the model is allowed to see |
| **Volatility** | `stable` · `volatile` · `ephemeral` | where it lives / when it's discarded |

`stable` details live in the durable **Vault** (keyed by canonical label, with **aliases** so `FIRST_NAME` ≡ `forename`); `volatile`/`ephemeral` live in the per-session/per-request **ActiveContext**. Canonical labels aspire to a shared standard; aliases bridge each site's vocabulary and **grow automatically** when you confirm an AI match.

**2. Two independent trust layers, surfaced before submit:**

- **Match-confidence** → per field: **green** (certain — canonical/alias match), **yellow** (AI-connected — eyeball it), **red** (missing — fill it).
- **Sensitivity** → the **Gate**: any `sensitive` value sits behind an opt-in lock in the review — it's never filled silently — and its value **never reaches the model** (the matcher sees labels/aliases only and returns a canonical label; the value is looked up locally). Nothing is entered or submitted except by your explicit Fill / Fill & Submit click.

## How it works

On a form page, focusing a fillable field shows an **"Autofill the entire page?"** badge; clicking it queues the fill for when the panel opens (toolbar icon, **Alt+Shift+F**, or right-click → *Autofill this page with Vaultofill*), which runs the pipeline:

```
sweep the DOM → deterministic match (canonical/alias) → one LLM call labels the rest
  → review (fields ordered missing → yellow → green; sensitive behind a lock)
  → Fill / Fill & Submit per click → confirmed matches teach aliases,
    novel labels are remembered so they converge across sites
```

Each tab keeps its own live review; values you save are tiered **Permanent** (vault), **Temporary** (this browser session), or **One-time** (never stored — the default for novel fields).

The label-matching model runs **on-device in the browser via WebGPU** (web-llm) — no server to run, and on this default path field labels never leave your machine. It sits behind a pluggable `ModelClient` port; if WebGPU is unusable (or the model isn't ready within the fill's timeout) it falls back to an **OpenAI-compatible endpoint** from stored config (unset by default — no fallback happens unless you configure one; field questions and label names, never values, are sent to it).

## Status — v1.0

The full pipeline is built and tested (500+ tests against a corpus of 34 form fixtures, including end-to-end fill/linking runs); the extension loads in Chrome and Firefox.

- ✅ Core: two-axis vault (canonical labels + aliases + named variants), deterministic + LLM matcher with value-withholding, open-set label learning (novel fields converge across sites), Gate
- ✅ Extension: side-panel review UI (per-tab live reviews, tier badges, sensitive locks), autofill badge, tabbed settings (saved values / learned fields), optional **at-rest vault encryption** (AES-GCM via WebCrypto, unlock once per browser session or per panel open), GPU diagnostics
- ✅ Tests: unit + integration (cross-form field linking, vault growth) + a live-model labeling eval harness

**Deferred (not designed out):** a site-served `form.json` protocol path, discovery/navigation to the form, OS-keychain companion for `sensitive` storage, mobile (Firefox Android) / iOS.

## Build & install

```bash
npm install
npm test          # vitest — unit suite
npm run build     # bundles to dist/chrome/ and dist/firefox/
```

`npm run build` produces a separate unpacked extension per browser:

- **`dist/chrome/`** — MV3 with a `side_panel`; the model runs in an offscreen document.
- **`dist/firefox/`** — MV3 with a `sidebar_action`; the model runs in the sidebar.

**Load it:**

- **Chrome / Chromium:** `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/chrome/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `dist/firefox/manifest.json`. (Temporary add-ons are cleared when Firefox restarts.)

Open a form page, then open the panel — **Alt+Shift+F**, the toolbar icon, or right-click → **Autofill this page with Vaultofill** — and click **Read this Page**. (Focusing a field also offers an **Autofill the entire page?** badge that queues the fill for the next panel open.)

### On-device model (WebGPU)

Inference runs locally via WebGPU — the first fill downloads the model weights (~1 GB) and caches them for reuse. It needs a **hardware-accelerated** WebGPU adapter; a CPU software renderer makes shader compilation minutes-long and can freeze the tab. The panel footer diagnoses this and shows the flags to set:

- **Chrome on Linux:** enable `chrome://flags/#enable-vulkan` and `chrome://flags/#enable-unsafe-webgpu`, then restart. Check `chrome://gpu` — you want a hardware backend (e.g. Vulkan/RADV), not SwiftShader or "compatibility mode".
- **Firefox:** WebGPU on Linux is still experimental — enable `dom.webgpu.enabled` in `about:config`.

If the on-device model isn't usable, filling falls back to the last-resort endpoint described above (unset by default). Try it against the form fixtures in `tests/fixtures/forms/` (`npm run serve:forms` serves them on `:8000`).

## Architecture

```
src/core/            pure domain — no browser APIs, DOM only via injected Document
  details/           Vault (canonical labels + aliases + variants) · ActiveContext (session)
  form/              DOM sweep (sweepFields · fieldDetect · visibility · vofId · findSubmit) · DomFormSource
  labels/            canonical seed labels · label vocabulary · LabelRegistry (learned labels) · LLM labeling
  fill/              classify (deterministic + LLM matcher) · persistReview (write-back + alias/label learning)
  gate/              sensitivity gating policy
  crypto/            at-rest vault cipher (PBKDF2 → AES-GCM envelope)
  planner/           ModelClient port + adapters (web-llm · OpenAI-compatible)
src/ext/             browser wiring
  content/           page RPC (fill/read) · autofill badge
  panel/             side panel: review UI · settings · model provider · per-tab sessions
  offscreen/         Chrome offscreen model host
  storage/           browser.storage backends · encrypted vault store
src/eval/            labeling eval harness (scripts/eval-labels.mjs)
```

## License

Vaultofill is source-available under the **Business Source License 1.1** — free for any use except offering it (or a derivative) as a competing commercial product or service. Each version converts to **Apache 2.0** four years after its release. See [LICENSE.md](LICENSE.md).
