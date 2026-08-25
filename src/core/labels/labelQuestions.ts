import { ModelClient, CompletionRequest } from "../planner/modelClient";
import { CanonicalLabel } from "./canonicalLabels";

export const UNKNOWN = "UNKNOWN";

/**
 * The single LLM job: map each form question to a canonical label. All questions
 * go in ONE prompt; the reply is a JSON array of labels, one per question in
 * order. A response schema is attached and adapters that support constrained
 * decoding (e.g. the OpenAI-compatible one) use it; sanitize() is the actual
 * guarantee — it coerces any reply back to a known label or UNKNOWN.
 */
export function buildLabelPrompt(questions: string[], vocab: CanonicalLabel[]): CompletionRequest {
  const labelList = vocab
    .map((l) => {
      const also = l.aliases.length ? ` (also called: ${l.aliases.join(", ")})` : "";
      return `- ${l.name}: ${l.description}${also}`;
    })
    .join("\n");
  const numbered = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const system =
    "You map web-form field questions to canonical labels. For EACH numbered question:\n" +
    "1. If one of the KNOWN labels below fits, reuse it (prefer reusing a known label — pick the MOST SPECIFIC one).\n" +
    "2. If none fits, INVENT a concise UPPER_SNAKE_CASE label naming what the field asks for " +
    "(e.g. CUMULATIVE_GPA, LINKEDIN_URL, VEHICLE_MAKE). Do not force an unrelated known label.\n" +
    '3. Use "UNKNOWN" only for fields with no fillable personal value (a captcha, a search box, a submit button).\n' +
    "Reply with ONLY a JSON array of label names — exactly one per question, in the same order.\n\n" +
    "Known labels:\n" +
    labelList;
  const user = "Questions (answer in this order):\n" + numbered;
  // Free-string items (not an enum) so the model can propose NEW labels; sanitize()
  // validates/normalises them. minItems/maxItems keep one answer per question.
  const responseSchema = {
    type: "array",
    items: { type: "string" },
    minItems: questions.length,
    maxItems: questions.length,
  };
  return { system, messages: [{ role: "user", content: user }], supportsGrammar: false, responseSchema };
}

// A well-formed canonical label: UPPER_SNAKE_CASE, 2–40 chars, starts with a letter.
const LABEL_RE = /^[A-Z][A-Z0-9_]{1,39}$/;

/** Coerce a free-form string to a canonical label (UPPER_SNAKE_CASE), or "" if it
 *  can't be a valid label. Shared by the model-reply cleaner and the review's
 *  "save as new label" correction. */
export function toCanonicalLabel(v: string): string {
  const up = v.trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z0-9_]/g, "").replace(/^_+|_+$/g, "");
  return LABEL_RE.test(up) ? up : "";
}

/** Normalise a free-form model reply into a canonical label: an exact known label
 *  is kept; otherwise coerce to UPPER_SNAKE_CASE and accept it as a NEW label when
 *  well-formed, else UNKNOWN. This is what lets the model create labels for fields
 *  the vault has never seen. */
function clean(v: unknown, known: Set<string>): string {
  if (typeof v !== "string") return UNKNOWN;
  const trimmed = v.trim();
  if (trimmed === UNKNOWN) return UNKNOWN;
  if (known.has(trimmed)) return trimmed;
  return toCanonicalLabel(trimmed) || UNKNOWN; // a known variant normalises back to the known name; else a new label
}

/**
 * Coerce the model's reply into a trusted {question -> known-label|UNKNOWN} map.
 * Accepts either an object keyed by question, or an array of labels in question
 * order (small models sometimes reply with a bare array).
 */
function sanitize(questions: string[], raw: unknown, known: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    questions.forEach((q, i) => { out[q] = clean(raw[i], known); });
    return out;
  }
  const reply = (raw ?? {}) as Record<string, unknown>;
  for (const q of questions) out[q] = clean(reply[q], known);
  return out;
}

export async function labelQuestions(
  questions: string[],
  vocab: CanonicalLabel[],
  model: ModelClient,
): Promise<Record<string, string>> {
  if (questions.length === 0) return {};
  const known = new Set(vocab.map((l) => l.name));
  let raw: unknown;
  try {
    raw = await model.complete<unknown>(buildLabelPrompt(questions, vocab));
  } catch {
    // Model call failed or the reply couldn't be parsed (e.g. a truncated JSON
    // array when generation hit the token cap). Degrade to all-UNKNOWN so the
    // fill continues (fields become "missing") instead of aborting.
    raw = undefined;
  }
  return sanitize(questions, raw, known);
}
