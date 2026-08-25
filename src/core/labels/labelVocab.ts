import { CanonicalLabel } from "./canonicalLabels";
import { Vault } from "../details/vault";
import { LabelRegistry } from "./labelRegistry";
import { humanizeWords } from "./humanize";

/** Dedupe case-insensitively, keeping the first-seen surface form. Vault aliases
 *  grow from raw form labels (arbitrary casing), so an exact-case Set would leak
 *  near-duplicates like "email"/"Email" into the prompt. */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}


/** Word tokens (≥3 chars) for coarse relevance overlap; drops noise like "of"/"is". */
function tokenize(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of b) if (a.has(t)) n++;
  return n;
}

/** Cap on how many invented (registry-only) labels get injected into a single
 *  labeling prompt — enough to converge realistic vocabularies, few enough to keep
 *  a small model from force-fitting fields to stale labels. Seeds and vault-backed
 *  labels don't count against it. */
export const MAX_INVENTED = 40;

export interface VocabOptions {
  /** The current form's questions — invented labels are ranked by relevance to
   *  these, so a form only sees its plausibly-relevant learned vocabulary. */
  questions?: string[];
  /** Max invented labels to inject (default MAX_INVENTED). */
  maxInvented?: number;
}

/**
 * Build the runtime label vocabulary: each base (seed) label's authored
 * description kept as-is, with its seed aliases extended by the aliases the user's
 * vault has accumulated for it. PLUS any labels the model invented for novel
 * fields — held in the vault (a saved value) OR the LabelRegistry (remembered
 * regardless of value, even One-time fills) — so the model reuses them next time
 * instead of inventing a different name. This is how the label vocabulary grows
 * and converges across sites without hand-curating a big list.
 */
export function buildLabelVocab(
  baseLabels: CanonicalLabel[],
  vault: Vault,
  registry?: LabelRegistry,
  opts: VocabOptions = {},
): CanonicalLabel[] {
  const regAliases = new Map((registry?.entries() ?? []).map((e) => [e.name, e.aliases]));
  const vocab: CanonicalLabel[] = baseLabels.map((label) => ({
    name: label.name,
    description: label.description,
    aliases: dedupe([...label.aliases, ...(vault.getByCanonical(label.name)?.aliases ?? []), ...(regAliases.get(label.name) ?? [])]),
  }));

  // Invented labels: from the vault (saved value) and the registry (remembered
  // label only). Add each once; merge whatever aliases both sources hold.
  const added = new Set(baseLabels.map((l) => l.name));
  const pushInvented = (name: string, aliases: string[]): void => {
    if (added.has(name)) return;
    added.add(name);
    vocab.push({ name, description: humanizeWords(name), aliases: dedupe(aliases) });
  };
  // Vault-backed invented labels are always included: the user saved a value, so
  // they're high-signal and few. (added grows to cover them.)
  for (const name of vault.keys()) pushInvented(name, [...(vault.getByCanonical(name)?.aliases ?? []), ...(regAliases.get(name) ?? [])]);

  // Registry-only invented labels are the unbounded tail — cap what we inject so a
  // large registry can't bloat the prompt / make the small model force-fit. Rank by
  // relevance to THIS form's questions, then recency (entries() is oldest→newest, so
  // a later index is more recent). A registry at or under the cap injects fully, so
  // convergence is unchanged until it actually grows large.
  //
  // Tradeoff: `overlap` is lexical, so a differently-phrased match (e.g. "preferred
  // colour" vs a FAVORITE_COLOR whose aliases say "favorite color") can score 0 and,
  // past the cap, lose its slot to newer labels and get re-invented. Recency is the
  // fallback — recent inventions are the likeliest to recur — and the label's own
  // humanized name usually shares a content word with the concept, so this mostly
  // bites the old + rephrased + past-cap long tail. Unnormalized overlap also lets an
  // alias-rich (often-reused) label rank higher: popularity as a deliberate prior.
  // EVAL_REGISTRY_PAD in scripts/eval-labels.mjs stress-tests this against a live model.
  const qTokens = tokenize((opts.questions ?? []).join(" "));
  const ranked = (registry?.entries() ?? [])
    .map((e, i) => ({ ...e, recency: i }))
    .filter((e) => !added.has(e.name))
    .map((e) => ({ e, score: overlap(qTokens, tokenize([humanizeWords(e.name), ...e.aliases].join(" "))) }))
    .sort((a, b) => b.score - a.score || b.e.recency - a.e.recency)
    .slice(0, opts.maxInvented ?? MAX_INVENTED);
  for (const { e } of ranked) pushInvented(e.name, e.aliases);

  return vocab;
}
