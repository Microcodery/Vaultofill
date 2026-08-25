import { FormField, Detail, FilledEntry } from "../types";
import { Vault } from "../details/vault";
import { ActiveContext } from "../details/activeContext";
import { ModelClient } from "../planner/modelClient";
import { labelQuestions, UNKNOWN, toCanonicalLabel } from "../labels/labelQuestions";
import { buildLabelVocab } from "../labels/labelVocab";
import { CANONICAL_LABELS, CANONICAL_LABEL_NAMES } from "../labels/canonicalLabels";
import { LabelRegistry } from "../labels/labelRegistry";

/** Anything that can resolve a question/label to a stored Detail. Both the Vault
 *  (permanent) and the ActiveContext (session/volatile) implement this. */
interface LabelIndex {
  findByLabel(label: string): Detail | undefined;
}

/** The question text used to label a field: the human-readable prompt, falling
 *  back to the field's own label when a source provides no question. */
function questionOf(field: FormField): string {
  return field.humanReadable || field.label;
}

/** Build a matched entry, attaching the label's saved variants so the review can
 *  offer a dropdown (including "+ New…" to add one), and the resolved variant.
 *  Only vault (stable) values have variants; a session/volatile value has none. */
function matchedEntry(field: FormField, detail: Detail, confidence: "certain" | "connected", vault: Vault): FilledEntry {
  const variants = detail.volatility === "stable" ? vault.getVariants(detail.canonicalLabel) : [];
  return {
    field: withLabel(field, detail.canonicalLabel),
    value: detail.value,
    confidence,
    detail,
    variant: detail.variant,
    ...(variants.length >= 1 ? { variants } : {}),
  };
}

/** Fill in the canonical label only when the field doesn't already carry one
 *  (e.g. a restored review's fields keep their persisted labels). */
function withLabel(field: FormField, canonical: string): FormField {
  return field.label ? field : { ...field, label: canonical };
}

/** A field matches deterministically when its label OR its question exactly
 *  matches a canonical name or a learned alias (case/punctuation-folded) in any
 *  of the given sources (vault first, then session context). */
export function deterministicMatch(field: FormField, ...sources: LabelIndex[]): Detail | undefined {
  for (const source of sources) {
    const byLabel = field.label ? source.findByLabel(field.label) : undefined;
    if (byLabel) return byLabel;
    const byQuestion = field.humanReadable ? source.findByLabel(field.humanReadable) : undefined;
    if (byQuestion) return byQuestion;
  }
  return undefined;
}

/**
 * Two-stage classify, resolving values from the Vault (permanent) and the
 * ActiveContext (session/volatile — so a booking date entered on one site is
 * reused on the next):
 *   1. Deterministic — a field whose question/label matches a canonical name or
 *      a learned alias resolves straight from a store (green/certain), no LLM.
 *   2. Labeling — the remaining questions go through ONE labelQuestions LLM call
 *      that maps each to a canonical label; a store hit is yellow/connected, a
 *      miss (or UNKNOWN) is red/missing.
 * Confirming a yellow match later appends its question as an alias (see
 * persistReview), so next time it resolves deterministically.
 */
export async function classify(
  fields: FormField[],
  vault: Vault,
  ctx: ActiveContext,
  model: ModelClient,
  onDeterministic?: (partial: (FilledEntry | undefined)[]) => void,
  registry?: LabelRegistry,
): Promise<FilledEntry[]> {
  const entries: FilledEntry[] = new Array(fields.length);
  const unknownIndices: number[] = [];
  const questions: string[] = [];

  fields.forEach((field, i) => {
    const detail = deterministicMatch(field, vault, ctx);
    if (detail) {
      entries[i] = matchedEntry(field, detail, "certain", vault);
    } else {
      unknownIndices.push(i);
      questions.push(questionOf(field));
    }
  });

  // Emit the deterministic (green) matches before the slow LLM call so the UI can
  // populate known fields immediately; unmatched slots are `undefined` (pending).
  onDeterministic?.(entries.slice());

  if (unknownIndices.length > 0) {
    // Label each DISTINCT question once: identical questions (e.g. multiple
    // label-less inputs that both resolve to "") must map to the same label,
    // and deduping avoids the question-keyed reply collapsing onto one field.
    const uniqueQuestions = [...new Set(questions)];
    // Pass the questions so the vocab injects only the invented labels relevant to
    // this form (capped), not the whole registry.
    const vocab = buildLabelVocab(CANONICAL_LABELS, vault, registry, { questions: uniqueQuestions });
    const labeled = await labelQuestions(uniqueQuestions, vocab, model);
    for (const i of unknownIndices) {
      const field = fields[i]!;
      const canonical = labeled[questionOf(field)];
      const known = canonical && canonical !== UNKNOWN ? canonical : undefined;
      const detail = known ? (vault.getByCanonical(known) ?? ctx.get(known)) : undefined;
      if (detail) {
        entries[i] = matchedEntry(field, detail, "connected", vault);
        continue;
      }
      // The label to save under: the model's, or — for a label-less DOM-swept
      // field the model marked UNKNOWN — one derived from the question.
      const label = known ?? (field.label ? undefined : toCanonicalLabel(questionOf(field)) || undefined);
      if (!label) {
        entries[i] = { field, value: null, confidence: "missing" };
        continue;
      }
      // A NOVEL (non-seed) label defaults to One-time (ephemeral, not saved): we're
      // unsure it's a lasting preference, so don't remember it unless the user opts
      // in via the tier badge. A known seed keeps its curated default tier.
      const novel = !CANONICAL_LABEL_NAMES.includes(label);
      entries[i] = {
        field: withLabel(field, label),
        value: null,
        confidence: "missing",
        ...(novel ? { volatility: "ephemeral" as const } : {}),
        ...(known ? {} : { derivedLabel: true }), // came from the question, not the model
      };
    }
  }

  return entries;
}
