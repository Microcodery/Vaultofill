import { matchKey } from "../details/vault";

/**
 * Durable **vocabulary** memory, kept separate from the value stores (Vault /
 * ActiveContext). When the model invents a label for a novel field, we remember
 * the LABEL here — even if the user doesn't save the VALUE (a One-time fill) —
 * so `buildLabelVocab` re-surfaces it next time and the model reuses it instead
 * of inventing a different name for the same concept (FAVORITE_COLOR, not a fresh
 * WHATS_YOUR_FAVORITE_COLOR). This is what makes the open-set labeling converge
 * across sites. It holds only label names + the question phrasings they came from
 * — no personal values — so it's cheap to keep. Growth is still bounded
 * (`maxLabels`): the whole vocabulary is injected into every labeling prompt, so an
 * unbounded registry would bloat the prompt and make a small model force-fit fields
 * to stale labels. Entries are kept in least-recently-learned → most-recently-learned
 * order (Map insertion order; `learn` re-inserts), so eviction and prompt-relevance
 * ranking can both use recency without a clock. `learn` fires on every confirmed
 * reuse, so this tracks real use, not just first sighting.
 */
export const DEFAULT_MAX_LABELS = 200;

/** A label name's sorted token set, so reorderings collide: HOME_PHONE and
 *  PHONE_HOME both → "home phone". */
function tokenSig(name: string): string {
  return [...new Set(name.toLowerCase().split("_").filter(Boolean))].sort().join(" ");
}

export class LabelRegistry {
  private m = new Map<string, string[]>(); // canonical label -> question aliases (matchKey-deduped)

  private readonly maxLabels: number;

  constructor(maxLabels: number = DEFAULT_MAX_LABELS) {
    this.maxLabels = Math.max(1, Math.floor(maxLabels)); // never evict the just-learned label
  }

  /** Remember a label, optionally with the question phrasing that produced it. */
  learn(name: string, alias?: string): void {
    if (!name) return;
    const aliases = this.m.get(name) ?? [];
    if (alias) {
      const n = matchKey(alias);
      if (n && !aliases.some((a) => matchKey(a) === n)) aliases.push(alias);
    }
    this.m.delete(name); // re-insert so this label moves to the most-recent end (LRU order)
    this.m.set(name, aliases);
    this.evict();
  }

  /** Drop the least-recently-learned labels past the cap (front of the Map). */
  private evict(): void {
    while (this.m.size > this.maxLabels) {
      const oldest = this.m.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.m.delete(oldest);
    }
  }

  /**
   * Merge near-duplicate labels the small model split across sessions
   * (FAVORITE_COLOR vs FAV_COLOR) — reuse prevents most, but a reuse miss can still
   * mint a variant, and nothing collapses ones that already accumulated. Two labels
   * merge when they share a multi-word normalized alias (the same question phrasing
   * got two names) OR have the same name token-set (reordered words). Merging is
   * transitive. A lone generic phrasing ("Name", "Email") is NOT a merge signal —
   * it attaches to distinct concepts across sites — so alias matching needs ≥2 words.
   * Precise on purpose: abbreviation/spelling variants with no shared phrasing are
   * NOT merged (that risks false merges corrupting the vocab) — a stronger signal
   * (stemming/edit-distance) is a future step gated on the eval. The most-established
   * name wins (most aliases, then earliest-learned) and absorbs the rest's aliases.
   * Registry-internal (vocab only) — it doesn't migrate values in the vault/context.
   * Returns how many labels were merged away; idempotent, safe to call anytime.
   */
  dedupe(): number {
    const items = [...this.m.entries()].map(([name, aliases], i) => ({ name, aliases, i }));
    const parent = items.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
    const union = (a: number, b: number): void => { parent[find(a)] = find(b); };

    // Union labels sharing a name token-set or a normalized alias.
    const bySig = new Map<string, number>();
    const byAlias = new Map<string, number>();
    for (const it of items) {
      const sig = tokenSig(it.name);
      const sigHit = bySig.get(sig);
      if (sigHit === undefined) bySig.set(sig, it.i); else union(it.i, sigHit);
      for (const a of it.aliases) {
        const k = matchKey(a);
        if (!k.includes("_")) continue; // single generic word ("name") → too ambiguous to merge on
        const aliasHit = byAlias.get(k);
        if (aliasHit === undefined) byAlias.set(k, it.i); else union(it.i, aliasHit);
      }
    }

    // Per group, the canonical rep = most aliases, then earliest-learned. Items
    // iterate oldest→newest and we replace only on strictly more aliases, so ties
    // keep the first-seen (most-established) name.
    const rep = new Map<number, number>();
    for (const it of items) {
      const r = find(it.i);
      const cur = rep.get(r);
      if (cur === undefined || it.aliases.length > items[cur]!.aliases.length) rep.set(r, it.i);
    }

    const survivors = new Set(rep.values());
    const merged = items.length - survivors.size;
    if (merged === 0) return 0;

    // Absorb each non-survivor's aliases into its group's rep (matchKey-deduped).
    const aliasesOf = new Map(items.map((it) => [it.i, [...it.aliases]]));
    for (const it of items) {
      const r = rep.get(find(it.i))!;
      if (r === it.i) continue;
      const target = aliasesOf.get(r)!;
      for (const a of it.aliases) {
        const k = matchKey(a);
        if (k && !target.some((t) => matchKey(t) === k)) target.push(a);
      }
    }

    // Rebuild in recency order, but promote each survivor to its group's NEWEST
    // member position — a concept reinforced by a recently-learned duplicate
    // shouldn't be left in an old, evictable slot.
    const groupNewest = new Map<number, number>(); // root -> max member index
    for (const it of items) {
      const r = find(it.i);
      groupNewest.set(r, Math.max(groupNewest.get(r) ?? -1, it.i));
    }
    this.m = new Map();
    for (const i of [...survivors].sort((a, b) => groupNewest.get(find(a))! - groupNewest.get(find(b))!)) {
      this.m.set(items[i]!.name, aliasesOf.get(i)!);
    }
    return merged;
  }

  /** All remembered labels with their accumulated aliases (copies). */
  entries(): { name: string; aliases: string[] }[] {
    return [...this.m.entries()].map(([name, aliases]) => ({ name, aliases: [...aliases] }));
  }

  /** Un-remember a label (e.g. a settings-view cleanup of an invented junk label). */
  remove(name: string): void {
    this.m.delete(name);
  }

  serialize(): string {
    return JSON.stringify([...this.m.entries()]);
  }

  load(s: string): void {
    this.m = new Map();
    try {
      for (const [name, aliases] of JSON.parse(s) as [string, string[]][]) {
        if (typeof name === "string" && Array.isArray(aliases)) this.m.set(name, aliases.filter((a) => typeof a === "string"));
      }
    } catch {
      // corrupt/legacy blob → start empty rather than fail
    }
    this.dedupe(); // collapse near-duplicate labels accumulated across sessions (before trimming)
    this.evict(); // a blob written before a lower cap (or hand-edited) still gets trimmed
  }
}
