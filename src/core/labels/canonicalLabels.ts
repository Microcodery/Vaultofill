import { Sensitivity, Volatility } from "../types";

export interface CanonicalLabel {
  name: string;
  description: string;
  /** Alternate phrasings/questions that map to this label. Starts empty and
   *  grows at runtime from the user's vault when they confirm a correction
   *  (see buildLabelVocab + Vault.addAlias). */
  aliases: string[];
}

/**
 * The standard label vocabulary: one authored, semantic `description` per label.
 * `aliases` seeds empty and is filled at runtime from the aliases the user's vault
 * has accumulated for each label, so the vocabulary personalizes as the user
 * confirms corrections. Descriptions carry the disambiguation (start vs end date,
 * primary vs secondary address line); they must NOT verbatim-echo eval questions.
 */
export const CANONICAL_LABELS: CanonicalLabel[] = [
  { name: "FIRST_NAME", description: "The person's given or first name", aliases: [] },
  { name: "LAST_NAME", description: "The person's family or last name", aliases: [] },
  { name: "FULL_NAME", description: "The person's complete name (first and last together)", aliases: [] },
  { name: "EMAIL", description: "An email address", aliases: [] },
  { name: "PHONE", description: "A telephone or contact number", aliases: [] },
  { name: "STREET_ADDRESS", description: "The primary street address line (building number and street)", aliases: [] },
  { name: "ADDRESS_LINE_2", description: "The secondary address line for an apartment, suite, unit, or floor — not the primary street", aliases: [] },
  { name: "CITY", description: "The city or town of an address", aliases: [] },
  { name: "STATE", description: "The state, province, or region of an address", aliases: [] },
  { name: "POSTAL_CODE", description: "The ZIP or postal code of an address", aliases: [] },
  { name: "COUNTRY", description: "The country of an address", aliases: [] },
  { name: "DATE_OF_BIRTH", description: "The person's date of birth", aliases: [] },
  { name: "START_DATE", description: "The first/start date of a stay, rental, or booking — when it begins (arrival, check-in, pickup)", aliases: [] },
  { name: "END_DATE", description: "The last/end date of a stay, rental, or booking — when it finishes (departure, check-out, return, drop-off)", aliases: [] },
  { name: "NUM_PEOPLE", description: "A count of people (guests, occupants, or party size)", aliases: [] },
  { name: "ROOM_TYPE", description: "The type or category of room", aliases: [] },
  { name: "SPECIAL_REQUESTS", description: "Free-text special requests, notes, or comments", aliases: [] },
  { name: "TIME", description: "A time of day for a booking or appointment", aliases: [] },
  { name: "COMPANY", description: "A company, organization, or employer name", aliases: [] },
  { name: "JOB_TITLE", description: "A job title, position, or role", aliases: [] },
  { name: "WEBSITE", description: "A general website or homepage URL (not a specific social profile)", aliases: [] },
  { name: "LINKEDIN", description: "A LinkedIn profile URL specifically — prefer over the generic website", aliases: [] },
  { name: "COVER_LETTER", description: "A cover letter or free-text application message", aliases: [] },
  { name: "PASSPORT_NUMBER", description: "A passport number", aliases: [] },
  { name: "CARD_NUMBER", description: "A payment or credit card number", aliases: [] },
];

export const CANONICAL_LABEL_NAMES: string[] = CANONICAL_LABELS.map((l) => l.name);

/**
 * Default storage lifetime per canonical label — a *storage* concern (not used
 * in the LLM prompt), so it lives here as a map rather than on CanonicalLabel:
 *   stable    → Vault, persisted permanently (names, address, contact, ids).
 *   volatile  → session store, reused across sites within a browser session
 *               (booking dates/party size/time — the same trip across hotels).
 *   ephemeral → filled but never persisted; clearly site-specific and pointless
 *               to reuse (room type, free-text requests, cover letters).
 */
const LABEL_VOLATILITY: Record<string, Volatility> = {
  FIRST_NAME: "stable",
  LAST_NAME: "stable",
  FULL_NAME: "stable",
  EMAIL: "stable",
  PHONE: "stable",
  STREET_ADDRESS: "stable",
  ADDRESS_LINE_2: "stable",
  CITY: "stable",
  STATE: "stable",
  POSTAL_CODE: "stable",
  COUNTRY: "stable",
  DATE_OF_BIRTH: "stable",
  COMPANY: "stable",
  JOB_TITLE: "stable",
  WEBSITE: "stable",
  LINKEDIN: "stable",
  PASSPORT_NUMBER: "stable",
  CARD_NUMBER: "stable",
  START_DATE: "volatile",
  END_DATE: "volatile",
  NUM_PEOPLE: "volatile",
  TIME: "volatile",
  ROOM_TYPE: "ephemeral",
  SPECIAL_REQUESTS: "ephemeral",
  COVER_LETTER: "ephemeral",
};

/** Default volatility for a KNOWN canonical label: the map above, else `stable`
 *  (so normal personal fields like EMAIL/NAME, absent from the map, persist).
 *  NOTE: a NOVEL (non-seed) label is defaulted to One-time by the matcher instead
 *  (see classify) — it isn't saved unless the user opts in via the tier badge —
 *  so this stable default only governs recognized labels. */
export function volatilityFor(canonicalLabel: string): Volatility {
  return LABEL_VOLATILITY[canonicalLabel] ?? "stable";
}

/** Labels whose values are sensitive by default, so a newly-captured value is
 *  gated on later fills even before the user marks it (financial / id numbers). */
const SENSITIVE_LABELS = new Set(["CARD_NUMBER", "PASSPORT_NUMBER"]);
// Keyword tokens that make an INVENTED label sensitive by default (SSN /
// BANK_ACCOUNT_NUMBER / CVV …). A sensitivity gate must fail SAFE — over-gating is
// a harmless extra opt-in lock, under-gating silently fills a credential — so the
// two lists lean toward matching:
//   DISTINCTIVE — strings that don't occur inside innocent labels, so a plain
//   substring is safe AND still catches an unsegmented model label (SSNVALUE, CVVCODE).
const SENSITIVE_TOKENS_DISTINCTIVE = ["SSN", "SOCIAL_SECURITY", "CVV", "CVC", "ROUTING", "IBAN", "PASSPORT", "PASSWORD"];
//   AMBIGUOUS — do occur inside innocent labels ("SHIPPING"⊃PIN, "SCORECARD"⊃CARD,
//   "SYNTAX"⊃TAX), so match only on token boundaries.
const SENSITIVE_TOKENS_BOUNDARY = ["CARD", "BANK", "ACCOUNT", "TAX", "PIN", "SECRET"];

/** Default sensitivity for a canonical label. Everything is at least "private";
 *  financial/id labels — seed or invented (by keyword) — default to "sensitive"
 *  so the gate catches them. */
export function sensitivityFor(canonicalLabel: string): Sensitivity {
  if (SENSITIVE_LABELS.has(canonicalLabel)) return "sensitive";
  if (SENSITIVE_TOKENS_DISTINCTIVE.some((t) => canonicalLabel.includes(t))) return "sensitive";
  // Boundary match (pad with "_" so a token only matches on token edges); still
  // handles multi-token markers because they carry their own internal "_".
  const padded = `_${canonicalLabel}_`;
  return SENSITIVE_TOKENS_BOUNDARY.some((t) => padded.includes(`_${t}_`)) ? "sensitive" : "private";
}
