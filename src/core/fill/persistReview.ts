import { Detail, FilledEntry, FormField, Volatility } from "../types";
import { Vault } from "../details/vault";
import { ActiveContext } from "../details/activeContext";
import { sensitivityFor, volatilityFor, CANONICAL_LABEL_NAMES } from "../labels/canonicalLabels";
import { UNKNOWN } from "../labels/labelQuestions";
import { LabelRegistry } from "../labels/labelRegistry";

/** Option-based controls: select/radio/checkbox. Their selected value is a
 *  site-specific option token, so their preference is stored as the option's
 *  human-readable LABEL (see portableOptionValue) and matched back onto each
 *  site's options on fill, rather than storing the raw token. */
export function isOptionControl(field: FormField): boolean {
  const tag = field.control?.tag;
  return tag === "select" || tag === "radio" || tag === "checkbox";
}

/** An option control's stored value is the chosen option's human-readable LABEL,
 *  not the site-specific option value — so a saved preference (e.g. a bed type)
 *  can match a different site's options next time (see buildControl/selectValue's
 *  label matching). Converts the selected value(s) to their label(s); passes a
 *  token through unchanged when no option matches it. */
export function portableOptionValue(field: FormField, value: string): string {
  const options = field.control?.options ?? [];
  const labelFor = (v: string): string => options.find((o) => o.value === v)?.label ?? v;
  return field.control?.tag === "checkbox"
    ? value.split("\n").filter(Boolean).map(labelFor).join("\n")
    : labelFor(value);
}

/**
 * Persist a captured value under its canonical label, routed by the label's
 * default volatility: stable → Vault (permanent), volatile → ActiveContext
 * (session, reused across sites), ephemeral → not persisted (site-specific).
 * Preserves any existing aliases/sensitivity. Returns the stored Detail, or
 * undefined when nothing was persisted (ephemeral or no canonical label).
 */
function persistDetail(
  canonicalLabel: string,
  value: string,
  existing: Detail | undefined,
  vault: Vault,
  ctx: ActiveContext,
  volatilityOverride?: Volatility,
  variantOverride?: string,
): Detail | undefined {
  if (!canonicalLabel) return undefined;
  // Prefer the review override, then the tier the value is already stored at (so
  // a prior move sticks), then the label default.
  const volatility = volatilityOverride ?? existing?.volatility ?? volatilityFor(canonicalLabel);
  const variant = (variantOverride ?? existing?.variant) || undefined; // "" → undefined (default)
  // Learned aliases belong to the variant they were learned on; a different/new
  // variant starts fresh so it doesn't inherit the default's question aliases.
  const sameVariant = existing && (existing.variant ?? "") === (variant ?? "");

  if (volatility === "ephemeral") {
    // Not saved; drop any prior copy of THIS variant so a tier change takes effect.
    vault.removeVariant(canonicalLabel, variant ?? "");
    ctx.remove(canonicalLabel);
    return undefined;
  }
  const detail: Detail = {
    canonicalLabel,
    variant,
    value,
    aliases: sameVariant ? existing!.aliases : [],
    // Preserve an existing sensitivity; a newly-captured value defaults by label
    // so a first-seen card/passport number is still gated on later fills.
    sensitivity: existing?.sensitivity ?? sensitivityFor(canonicalLabel),
    volatility,
  };
  // Keep this variant's value in exactly one store so a tier change moves it.
  if (volatility === "stable") {
    vault.set(detail); // upserts the variant, leaving the label's other variants
    ctx.remove(canonicalLabel);
  } else {
    ctx.set(canonicalLabel, detail); // context is single-value (no variants)
    vault.removeVariant(canonicalLabel, variant ?? "");
  }
  return detail;
}

/** Identify a field across the review round-trip: by stable elementId when both
 *  carry one, otherwise by label (restored reviews may lack elementIds). */
function sameField(a: FormField, b: FormField): boolean {
  return a.elementId != null && b.elementId != null ? a.elementId === b.elementId : a.label === b.label;
}

export interface ReviewResult {
  entries: FilledEntry[];
  confirmedYellow: FormField[];
}

/**
 * Persist the reviewed entries to the Vault (stable) / ActiveContext (volatile)
 * by volatility, and learn confirmed-yellow questions as aliases so they resolve
 * deterministically next time. Safe to call repeatedly on a re-fill (upserts).
 * When a `registry` is given, model-invented labels are remembered there (the
 * label vocabulary), separate from whether their VALUE is saved, so open-set
 * labels converge across sites (see learnInventedLabels). Called by the panel's
 * re-usable interactive review on each Fill click.
 */
export function persistReview(review: ReviewResult, vault: Vault, ctx: ActiveContext, registry?: LabelRegistry): void {
  if (registry) learnInventedLabels(review, vault, registry);
  for (const field of review.confirmedYellow) {
    const entry = review.entries.find((e) => sameField(e.field, field));
    const question = field.humanReadable || field.label;
    if (!entry?.detail || !question) continue;
    const store = entry.detail.volatility === "stable" ? vault : ctx;
    store.addAlias(entry.detail.canonicalLabel, question);
  }

  // Persist each canonical label at most once — two fields resolving to the same
  // label (e.g. "Email" + "Confirm email") must not have the second's tier
  // destructively remove()-move the first's value.
  const persisted = new Set<string>();
  for (const entry of review.entries) {
    if (!entry.value) continue; // null or "" → nothing selected/typed, nothing to store
    const label = entry.detail?.canonicalLabel ?? entry.field.label;
    if (!label) continue;
    // A One-time (ephemeral) fill with no OWNED prior value (entry.detail unset)
    // has nothing to save and nothing of its own to clean up — skip it, so it can't
    // delete a different stored value that merely shares this label. This happens
    // when a question-derived fallback red normalizes to an existing canonical name
    // that the deterministic match missed (matchKey vs toCanonicalLabel fold differently).
    // A genuine tier demotion of a matched value keeps entry.detail, so it still
    // removes its own stored copy below.
    if (entry.volatility === "ephemeral" && !entry.detail) continue;
    const key = JSON.stringify([label, entry.variant ?? ""]); // injective; labels/variants may contain spaces
    if (persisted.has(key)) continue;
    persisted.add(key);
    // A review-assigned label (red row, so entry.detail is unset) may name a
    // label already stored — look it up so persist preserves its aliases/tier/
    // sensitivity instead of overwriting them with a blank Detail.
    const existing = entry.detail ?? vault.getByCanonical(label) ?? ctx.get(label);
    // Option controls store the portable label, not the site-specific option value.
    const value = isOptionControl(entry.field) ? portableOptionValue(entry.field, entry.value) : entry.value;
    persistDetail(label, value, existing, vault, ctx, entry.volatility, entry.variant);
    // Once a label is backed by a saved vault value, its registry entry is redundant
    // (buildLabelVocab surfaces it from the vault) — and leaving it there lets dedupe
    // merge it away under a different name while the value stays put, orphaning the
    // value. Prune it so the vocabulary memory and the value store don't diverge.
    if (registry && vault.getByCanonical(label)) registry.remove(label);
  }
}

/**
 * Remember model-INVENTED labels the user filled, so `buildLabelVocab` re-surfaces
 * them and the model reuses the same name next site (open-set convergence). This
 * is intentionally decoupled from value persistence above: a novel field filled at
 * One-time doesn't save its VALUE, but we still remember its LABEL. We skip:
 * seed labels + labels already saved stable in the vault (both already in the
 * vocab), and question-DERIVED fallbacks (`entry.derivedLabel`) — those are
 * per-phrasing, not a semantic name, and remembering them would just bloat the
 * vocab.
 */
function learnInventedLabels(review: ReviewResult, vault: Vault, registry: LabelRegistry): void {
  for (const entry of review.entries) {
    if (!entry.value || entry.derivedLabel) continue;
    const label = entry.detail?.canonicalLabel ?? entry.field.label;
    if (!label || label === UNKNOWN || CANONICAL_LABEL_NAMES.includes(label)) continue;
    if (vault.getByCanonical(label)) continue; // already remembered via the vault → don't double-book
    registry.learn(label, entry.field.humanReadable || entry.field.label);
  }
}
