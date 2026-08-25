import { FilledEntry, Volatility } from "../../core/types";
import { volatilityFor } from "../../core/labels/canonicalLabels";
import { toCanonicalLabel } from "../../core/labels/labelQuestions";

/** A wrong question→label mapping to unlearn (remove the alias from the store). */
export interface Unlearn {
  label: string;
  alias: string;
}

/** The per-row state a review submit reads off the DOM controls. */
export interface RowInputs {
  /** Raw text from the "save as new label" input (unnormalized); undefined when
   *  the row has no relabel control. */
  newLabelRaw?: string;
  /** Current value in the row's value control (caller resolves the empty case). */
  currentValue: string;
  /** Whether the row's include checkbox is checked (true when there's no checkbox). */
  included: boolean;
  chosenVariant?: string;
  volatility?: Volatility;
}

export interface ResolvedRow {
  entry: FilledEntry;
  unlearn?: Unlearn;
}

/**
 * Resolve one review row on submit into the entry to persist, plus any alias to
 * unlearn. "Save as new label" reassigns the field to a valid, *different* label
 * and unlearns the old question→label mapping so the wrong match stops recurring
 * (a junk or same-as-current label is a no-op that never touches the value).
 *
 * The one subtlety: relabeling a *matched* row whose value box still holds the
 * pre-filled (wrong) value drops that value — it belonged to the old label. If
 * the user typed a correction, or the row was a red/unmatched one, the typed
 * value is kept.
 */
export function resolveReviewEntry(entry: FilledEntry, inputs: RowInputs): ResolvedRow {
  const newLabel = inputs.newLabelRaw !== undefined ? toCanonicalLabel(inputs.newLabelRaw) : "";
  const oldLabel = entry.detail?.canonicalLabel ?? entry.field.label;
  const relabeled = !!newLabel && newLabel !== oldLabel;

  // Unlearn only when correcting a real match: the alias that produced this wrong
  // label lives on entry.detail's label. A red/unmatched row never had a mapping,
  // so there's nothing to remove.
  let unlearn: Unlearn | undefined;
  if (relabeled && entry.detail) {
    const question = entry.field.humanReadable || entry.field.label;
    if (question) unlearn = { label: entry.detail.canonicalLabel, alias: question };
  }

  const field = relabeled ? { ...entry.field, label: newLabel } : entry.field;
  const detail = relabeled ? undefined : entry.detail;

  if (!inputs.included) return { entry: { ...entry, field, detail, value: null }, unlearn };

  const stillOldValue = relabeled && !!entry.detail && inputs.currentValue === (entry.value ?? "");
  const typedValue = stillOldValue ? "" : inputs.currentValue;
  if (typedValue === "") return { entry: { ...entry, field, detail, value: null }, unlearn };

  const confidence = entry.confidence === "missing" ? "certain" : entry.confidence;
  if (relabeled) {
    // A user-typed label is an intentional name (not a question-derived fallback),
    // so it's worth remembering in the vocabulary.
    return {
      entry: { ...entry, field, detail: undefined, value: typedValue, confidence, volatility: volatilityFor(newLabel), variant: undefined, derivedLabel: false },
      unlearn,
    };
  }
  return {
    entry: { ...entry, value: typedValue, confidence, volatility: inputs.volatility, variant: inputs.chosenVariant ?? entry.variant },
    unlearn,
  };
}
