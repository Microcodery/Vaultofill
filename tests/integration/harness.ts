// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { vi } from "vitest";
import { sweepFields, SweptField } from "../../src/core/form/sweepFields";
import { findSubmit } from "../../src/core/form/findSubmit";
import { FormField, FilledEntry, Detail, SubmitSpec } from "../../src/core/types";
import { Vault } from "../../src/core/details/vault";
import { ActiveContext } from "../../src/core/details/activeContext";
import { LabelRegistry } from "../../src/core/labels/labelRegistry";
import { classify } from "../../src/core/fill/matcher";
import { persistReview } from "../../src/core/fill/persistReview";
import { CompletionRequest, ModelClient } from "../../src/core/planner/modelClient";
import { PageBridge } from "../../src/core/page/pageBridge";

/** Every form fixture the harness exercises (index.html is a directory page, not a form). */
export const FIXTURE_NAMES = [
  "apartment-rental-application",
  "business-grant-application",
  "car-rental",
  "event-registration",
  "flight-booking",
  "food-ordering",
  "hotel-reservation",
  "job-application",
  "loan-application",
  "medical-intake",
  "newsletter-signup",
  "restaurant-reservation",
  "scholarship-application",
  "vendor-onboarding-w9",
] as const;

/** Parse with the jsdom-environment's own DOMParser (not a fresh `new JSDOM()`) so
 *  the parsed elements share the ambient realm's HTMLInputElement etc. classes that
 *  sweepFields' `instanceof` checks rely on. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** The exact SweptField→FormField mapping DomFormSource.getSchema performs: swept
 *  fields start with an empty `label` (the matcher's labeling stage fills it). */
export function toFormFields(sweeps: SweptField[]): FormField[] {
  return sweeps.map((f) => ({ label: "", humanReadable: f.humanReadable, elementId: f.elementId, control: f.control }));
}

export interface LoadedFixture {
  name: string;
  doc: Document;
  sweeps: SweptField[];
  fields: FormField[];
  submit: SubmitSpec | null;
}

export function loadFixture(name: string): LoadedFixture {
  const html = readFileSync(`tests/fixtures/forms/${name}.html`, "utf8");
  const doc = parseHtml(html);
  const sweeps = sweepFields(doc);
  return { name, doc, sweeps, fields: toFormFields(sweeps), submit: findSubmit(doc) };
}

// --- Deterministic fake model -------------------------------------------------

/** Ordered keyword rules mapping a form question to a canonical (or plausibly
 *  invented) label. First match wins; specific rules precede general ones. A few
 *  rules deliberately INVENT non-seed labels (GPA/essay/major) so the invention
 *  path is exercised. Everything unmatched is UNKNOWN — the matcher then derives a
 *  question-based label, mirroring a real red field. */
const RULES: [RegExp, string][] = [
  [/linkedin/, "LINKEDIN"],
  // Emergency-contact rules precede PHONE/NAME so "Emergency contact phone/name"
  // don't fall to PHONE/FULL_NAME. Phone-specific first.
  [/emergency contact (phone|number)/, "EMERGENCY_CONTACT_PHONE"],
  [/emergency/, "EMERGENCY_CONTACT"],
  [/e-?mail/, "EMAIL"],
  [/first name|given name/, "FIRST_NAME"],
  [/last name|surname|family name/, "LAST_NAME"],
  [/full name|legal name|\byour name\b/, "FULL_NAME"],
  [/phone|mobile|\btel\b/, "PHONE"],
  [/date of birth|\bdob\b|birth ?date/, "DATE_OF_BIRTH"],
  [/check-?in|arrival|pick-?up|\bembark|tour start|appointment date|event date|start date/, "START_DATE"],
  [/check-?out|departure|return|drop-?off|disembark|end date/, "END_DATE"],
  [/apartment|apt\b|suite|unit|address line 2/, "ADDRESS_LINE_2"],
  [/street|\baddress\b/, "STREET_ADDRESS"],
  [/\bcity\b|town/, "CITY"],
  [/state|province/, "STATE"],
  [/\bzip\b|postal/, "POSTAL_CODE"],
  [/country/, "COUNTRY"],
  // Overlap clusters (invented labels the different forms phrase differently).
  [/goals|objectives|mission|aim to achieve/, "COMPANY_GOALS"],
  [/number of employees|team size|how many.*employ/, "EMPLOYEE_COUNT"],
  [/years in (business|operation)|how long.*operat/, "YEARS_IN_BUSINESS"],
  [/annual revenue|gross annual|yearly gross|\brevenue\b/, "ANNUAL_REVENUE"],
  [/\bein\b|employer identification|federal tax id|tax id/, "TAX_ID"],
  [/dietary|allerg/, "DIETARY_RESTRICTIONS"],
  [/guest|occupant|passenger|party size|attendee|number of people|group size|headcount/, "NUM_PEOPLE"],
  [/room type/, "ROOM_TYPE"],
  [/special request|comments|\bnotes\b/, "SPECIAL_REQUESTS"],
  [/\btime\b/, "TIME"],
  [/company|employer|organi[sz]ation|business name/, "COMPANY"],
  [/job title|position|desired role|\brole\b/, "JOB_TITLE"],
  [/website|homepage|portfolio|\burl\b/, "WEBSITE"],
  [/cover letter/, "COVER_LETTER"],
  [/passport/, "PASSPORT_NUMBER"],
  [/card number|credit card/, "CARD_NUMBER"],
  // Invented (non-seed) labels — realistic for these fixtures, absent from the vocab.
  [/\bgpa\b/, "CUMULATIVE_GPA"],
  [/essay/, "PERSONAL_ESSAY"],
  [/major|field of study/, "INTENDED_MAJOR"],
  [/\bname\b/, "FULL_NAME"],
];

export function labelForQuestion(question: string): string {
  const q = question.toLowerCase();
  for (const [re, label] of RULES) if (re.test(q)) return label;
  return "UNKNOWN";
}

/** Recover the numbered questions the matcher put in the labeling prompt so the
 *  fake can answer them in order (buildLabelPrompt formats them as "N. question").
 *  Positions by the prompt's OWN number so an empty question ("N. ") keeps its slot
 *  and doesn't shift every later label — matching the real model, which answers all
 *  N in order. An empty slot → "" → UNKNOWN. */
function parseQuestions(req: CompletionRequest): string[] {
  const content = req.messages.map((m) => m.content).join("\n");
  const byNumber: string[] = [];
  for (const line of content.split("\n")) {
    const m = /^\s*(\d+)\.\s?(.*?)\s*$/.exec(line);
    if (m) byNumber[Number(m[1]) - 1] = m[2]!;
  }
  return Array.from(byNumber, (q) => q ?? "");
}

export type FakeModel = ModelClient & { complete: ReturnType<typeof vi.fn> };

/** A pure, offline ModelClient: it reads the questions out of the prompt and
 *  returns a JSON array of labels (one per question, in order) via the keyword map.
 *  No network, no timers — deterministic. */
export function makeKeywordModel(): FakeModel {
  const complete = vi.fn(async (req: CompletionRequest) => parseQuestions(req).map(labelForQuestion));
  return { complete } as unknown as FakeModel;
}

/** A model that always throws, to prove deterministic matches resolve without it
 *  (labelQuestions swallows the throw → the rest degrade to missing). */
export function makeThrowingModel(): FakeModel {
  const complete = vi.fn(async () => {
    throw new Error("no LLM in integration tests");
  });
  return { complete } as unknown as FakeModel;
}

// --- Seeded vault -------------------------------------------------------------

const D = (canonicalLabel: string, value: string, aliases: string[] = []): Detail => ({
  canonicalLabel,
  value,
  aliases,
  sensitivity: "private",
  volatility: "stable",
});

/** A realistic person's permanent details. `withAliases` seeds question phrasings
 *  that don't fold onto a canonical name (e.g. "Email address"), so those fields
 *  resolve deterministically (certain) — off by default so the LLM (connected)
 *  path can be exercised too. */
export function seedVault(withAliases = false): Vault {
  const a = (...xs: string[]) => (withAliases ? xs : []);
  const v = new Vault();
  v.set(D("FULL_NAME", "Ada Lovelace"));
  v.set(D("FIRST_NAME", "Ada"));
  v.set(D("LAST_NAME", "Lovelace"));
  v.set(D("EMAIL", "ada@example.com", a("Email address", "Email", "Contact email", "Remittance email")));
  v.set(D("PHONE", "+1-555-0100", a("Phone number", "Phone", "Mobile")));
  v.set(D("STREET_ADDRESS", "12 Analytical Way", a("Street address", "Address")));
  v.set(D("CITY", "London"));
  v.set(D("STATE", "CA", a("State/Province", "State / Province")));
  v.set(D("POSTAL_CODE", "94000", a("ZIP code", "Postal code", "ZIP")));
  v.set(D("COUNTRY", "United Kingdom"));
  v.set(D("DATE_OF_BIRTH", "1815-12-10"));
  v.set(D("COMPANY", "Analytical Engines", a("Company", "Employer")));
  v.set(D("JOB_TITLE", "Mathematician", a("Desired role", "Job title", "Position")));
  v.set(D("LINKEDIN", "https://linkedin.com/in/ada", a("LinkedIn URL", "LinkedIn")));
  return v;
}

// --- jsdom-backed PageBridge --------------------------------------------------

/** A PageBridge that operates directly on a parsed jsdom Document, so DomFormSource
 *  stages values into REAL input elements (located by their data-vof id). Highlights
 *  are recorded as a data attribute so tests can assert them without a layout engine. */
export class JsdomPageBridge implements PageBridge {
  clickedSubmit?: string;
  constructor(private doc: Document) {}

  private el(elementId: string): Element | null {
    return this.doc.querySelector(`[data-vof="${elementId}"]`);
  }

  async readForm() {
    return { fields: sweepFields(this.doc), submit: findSubmit(this.doc) };
  }
  async fill(elementId: string, value: string): Promise<void> {
    const el = this.el(elementId);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      el.value = value;
    }
  }
  async setChecked(elementId: string, checked: boolean): Promise<void> {
    const el = this.el(elementId);
    if (el instanceof HTMLInputElement) el.checked = checked;
  }
  async highlight(elementId: string, color: string): Promise<void> {
    this.el(elementId)?.setAttribute("data-vof-highlight", color);
  }
  async clickSubmit(elementId: string): Promise<void> {
    this.clickedSubmit = elementId;
  }
  currentDomain(): string {
    return "fixture.test";
  }
}

// --- Cross-form linking clusters ---------------------------------------------

/** One real-world concept that several forms ask about with DIFFERENT wording, all
 *  resolving (via the fake model) to one canonical `label`. Drives the linking
 *  tests: fill it on the first form, assert the rest reuse the saved value. */
export interface Cluster {
  label: string;
  value: string;
  forms: string[];
}

/** The heavy-overlap concepts across the fixtures. Each `forms` entry phrases the
 *  concept differently (see the fixtures' label text); they all map to `label`. */
export const CLUSTERS: Cluster[] = [
  {
    label: "COMPANY_GOALS",
    value: "Expand to three new regional markets by 2027.",
    forms: ["small-business-grant", "innovation-grant", "nonprofit-mission-grant", "startup-accelerator"],
  },
  {
    label: "ANNUAL_REVENUE",
    value: "1250000",
    forms: ["small-business-grant", "startup-accelerator", "business-line-of-credit", "supplier-onboarding"],
  },
  {
    label: "DIETARY_RESTRICTIONS",
    value: "Vegetarian, no nuts",
    forms: ["cruise-booking", "guided-tour-booking", "tech-conference-registration", "workshop-signup", "catering-order"],
  },
  {
    label: "EMERGENCY_CONTACT",
    value: "Jordan Rivera",
    forms: ["campground-reservation", "tech-conference-registration", "marathon-registration", "dental-new-patient", "clinical-trial-screening", "gym-membership"],
  },
  {
    label: "EMPLOYEE_COUNT",
    value: "42",
    forms: ["small-business-grant", "startup-accelerator", "saas-trial-signup"],
  },
  {
    label: "TAX_ID",
    value: "12-3456789",
    forms: ["nonprofit-mission-grant", "business-line-of-credit", "supplier-onboarding"],
  },
  {
    label: "NUM_PEOPLE",
    value: "4",
    forms: ["cruise-booking", "campground-reservation", "guided-tour-booking", "catering-order"],
  },
];

/** A fresh set of the three stores the pipeline threads together. */
export interface LinkEnv {
  vault: Vault;
  ctx: ActiveContext;
  registry: LabelRegistry;
}
export const newEnv = (): LinkEnv => ({ vault: new Vault(), ctx: new ActiveContext(), registry: new LabelRegistry() });

/** Classify `form` in `env` with the shared fake model (a fresh model per call, so
 *  callers can assert on its `complete` calls by passing their own). */
export async function classifyForm(form: string, env: LinkEnv, model: FakeModel = makeKeywordModel()): Promise<FilledEntry[]> {
  return classify(loadFixture(form).fields, env.vault, env.ctx, model as never, undefined, env.registry);
}

/** Find the classified entry the model mapped to `label` on `form`, or throw. */
export async function entryFor(form: string, label: string, env: LinkEnv): Promise<FilledEntry> {
  const entry = (await classifyForm(form, env)).find((e) => e.field.label === label);
  if (!entry) throw new Error(`${form}: no field resolved to ${label}`);
  return entry;
}

/** Simulate the user filling the `label` field on `form` with `value` at the
 *  PERMANENT (stable) tier and saving — so the value is remembered and can link to
 *  other forms. `confirm` also learns the field's question as an alias (the
 *  deterministic-next-time path). */
export async function fillAndSave(
  form: string,
  label: string,
  value: string,
  env: LinkEnv,
  opts: { confirm?: boolean } = {},
): Promise<FilledEntry> {
  const entry = await entryFor(form, label, env);
  const filled: FilledEntry = { ...entry, value, confidence: "certain", volatility: "stable" };
  persistReview({ entries: [filled], confirmedYellow: opts.confirm ? [filled.field] : [] }, env.vault, env.ctx, env.registry);
  return filled;
}

/** Simulate the user filling EVERY recognized field on `form` (any that resolved to
 *  a real canonical label — skipping question-derived fallbacks) with a deterministic
 *  value at the PERMANENT tier, and saving. Returns the set of canonical labels
 *  persisted, for asserting how the vault grows form-by-form. */
export async function fillForm(form: string, env: LinkEnv, valueFor: (label: string) => string): Promise<Set<string>> {
  const filled: FilledEntry[] = (await classifyForm(form, env))
    .filter((e) => e.field.label && !e.derivedLabel)
    .map((e) => ({ ...e, value: valueFor(e.field.label), confidence: "certain" as const, volatility: "stable" as const }));
  persistReview({ entries: filled, confirmedYellow: [] }, env.vault, env.ctx, env.registry);
  return new Set(filled.map((e) => e.field.label));
}

/** Fill the `label` field on `form` at its NATURAL tier (whatever classify assigned:
 *  One-time for a novel label, the curated default for a seed — e.g. volatile for a
 *  date) and persist. Unlike fillAndSave, does NOT force a permanent tier, so callers
 *  can assert the real defaults: a novel field is One-time (not saved), a volatile
 *  seed lands in the session context, not the vault. */
export async function fillNatural(form: string, label: string, value: string, env: LinkEnv): Promise<FilledEntry> {
  const filled: FilledEntry = { ...(await entryFor(form, label, env)), value };
  persistReview({ entries: [filled], confirmedYellow: [] }, env.vault, env.ctx, env.registry);
  return filled;
}
