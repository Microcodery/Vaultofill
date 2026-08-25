import { DomFormSource } from "../src/core/form/domFormSource";
import { classify } from "../src/core/fill/matcher";
import { persistReview, ReviewResult } from "../src/core/fill/persistReview";
import { FilledEntry, FormField } from "../src/core/types";
import { renderProgressive, renderReview } from "../src/ext/panel/reviewView";
import { Unlearn } from "../src/ext/panel/resolveReviewEntry";
import { makeKeywordModel } from "./keywordModel";
import { makeDemoEnv, DemoEnv } from "./demoVault";
import { DemoBridge } from "./demoBridge";

interface FormEntry { file: string; title: string; }

const model = makeKeywordModel();
let env: DemoEnv = makeDemoEnv();
let currentFile = "";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const select = $<HTMLSelectElement>("form-select");
const iframe = $<HTMLIFrameElement>("form-frame");
const panel = $<HTMLDivElement>("review");
const status = $<HTMLDivElement>("status");
const resetButton = $<HTMLButtonElement>("reset");
const readButton = $<HTMLButtonElement>("read");

function setStatus(text: string): void {
  status.textContent = text;
}

/** Point the iframe at a fixture and resolve once it has loaded. */
function loadIntoFrame(url: string): Promise<void> {
  return new Promise((resolve) => {
    iframe.addEventListener("load", () => resolve(), { once: true });
    iframe.src = url;
  });
}

/** Inject the iframe-realm bridge and wait until it registers itself. The bridge
 *  MUST be built inside the iframe's realm (its instanceof checks only hold there),
 *  so we load demoFrame.js into the frame and read back window.__vofBridge. */
async function frameBridge(): Promise<DemoBridge> {
  const win = iframe.contentWindow;
  const idoc = iframe.contentDocument;
  if (!win || !idoc) throw new Error("iframe document is not accessible");
  if (win.__vofBridge) return win.__vofBridge;

  const script = idoc.createElement("script");
  script.type = "module";
  script.src = new URL("demoFrame.js", window.location.href).href;
  let loadError = false;
  script.addEventListener("error", () => { loadError = true; }, { once: true });
  (idoc.head ?? idoc.documentElement).appendChild(script);

  for (let i = 0; i < 200; i++) {
    if (win.__vofBridge) return win.__vofBridge;
    if (loadError) throw new Error("demoFrame.js failed to load");
    await new Promise((r) => window.setTimeout(r, 25));
  }
  throw new Error("demoFrame.js did not initialize the bridge");
}

/** Read the current form and render the interactive review. Re-runnable: each
 *  Fill re-invokes this so freshly-saved values show up green on the next pass. */
async function readPage(): Promise<void> {
  let bridge: DemoBridge;
  try {
    bridge = await frameBridge();
  } catch (err) {
    setStatus(`Could not read the page: ${(err as Error).message}`);
    return;
  }

  const source = new DomFormSource({ page: bridge });
  let fields: FormField[];
  try {
    fields = (await source.getSchema()).fields;
  } catch (err) {
    panel.innerHTML = "";
    setStatus(`No fillable form detected (${(err as Error).message}).`);
    return;
  }

  setStatus(`Classifying ${fields.length} field${fields.length === 1 ? "" : "s"}…`);
  const entries = await classify(
    fields,
    env.vault,
    env.ctx,
    model,
    (partial) => renderProgressive(panel, fields, partial),
    env.registry,
  );

  renderReview(panel, entries, (review, unlearn, submit) => void applyReview(source, review, unlearn, submit));
  setStatus(summarize(entries));
}

function summarize(entries: FilledEntry[]): string {
  const n = (c: string): number => entries.filter((e) => e.confidence === c).length;
  return `${entries.length} fields — ${n("certain")} known, ${n("connected")} linked, ${n("missing")} new.`;
}

/** Persist the review, stage values into the iframe, optionally "submit", then
 *  re-read so newly-saved values render green. Mirrors the extension panel's
 *  applyReview (unlearn wrong aliases, then persistReview + stage + commit). */
async function applyReview(source: DomFormSource, review: ReviewResult, unlearn: Unlearn[], submit: boolean): Promise<void> {
  for (const u of unlearn) {
    env.vault.removeAlias(u.label, u.alias);
    env.ctx.removeAlias(u.label, u.alias);
  }
  persistReview(review, env.vault, env.ctx, env.registry);
  await source.stage(review.entries);
  if (submit) await source.commit();
  setStatus(submit ? "Filled and submitted (simulated) — re-reading…" : "Filled — re-reading to show saved values…");
  await readPage();
}

async function loadForm(file: string): Promise<void> {
  currentFile = file;
  panel.innerHTML = "";
  setStatus("Loading form…");
  await loadIntoFrame(`forms/${file}`);
  await readPage();
}

function resetDemo(): void {
  env = makeDemoEnv();
  setStatus("Demo data reset to the seed.");
  if (currentFile) void loadForm(currentFile);
}

async function init(): Promise<void> {
  const forms: FormEntry[] = await fetch("forms.json").then((r) => r.json());
  for (const f of forms) {
    const option = document.createElement("option");
    option.value = f.file;
    option.textContent = f.title;
    select.appendChild(option);
  }

  select.addEventListener("change", () => void loadForm(select.value));
  readButton.addEventListener("click", () => void readPage());
  resetButton.addEventListener("click", resetDemo);

  if (forms.length) {
    select.value = forms[0]!.file;
    await loadForm(forms[0]!.file);
  }
}

void init();
