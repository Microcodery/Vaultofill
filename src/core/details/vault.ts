import { Detail } from "../types";

/** Normalize a label/question for case- and punctuation-insensitive matching. */
export const matchKey = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Find the detail whose canonical name or one of its aliases matches `label`
 *  (normalized). Shared by Vault and ActiveContext. */
export function findDetailByLabel(details: Iterable<Detail>, label: string): Detail | undefined {
  const n = matchKey(label);
  for (const d of details) if (matchKey(d.canonicalLabel) === n || d.aliases.some((a) => matchKey(a) === n)) return d;
  return undefined;
}

export class Vault {
  private m = new Map<string, Detail[]>(); // canonicalLabel -> its variants (first = default)

  set(d: Detail) {
    if (d.volatility !== "stable") throw new Error("Vault holds only stable details");
    const list = this.m.get(d.canonicalLabel) ?? [];
    const key = d.variant ?? "";
    const i = list.findIndex((x) => (x.variant ?? "") === key);
    if (i >= 0) list[i] = d;
    else list.push(d);
    this.m.set(d.canonicalLabel, list);
  }

  /** The default (first) variant for a label — single-Detail API for callers
   *  that don't care about variants. */
  getByCanonical(label: string) {
    return this.m.get(label)?.[0];
  }

  /** All named variants stored for a label (empty if none). Returns a copy so
   *  callers can't mutate (or observe later mutations of) the internal list. */
  getVariants(label: string): Detail[] {
    return [...(this.m.get(label) ?? [])];
  }

  keys() {
    return [...this.m.keys()];
  }

  findByLabel(label: string): Detail | undefined {
    for (const list of this.m.values()) {
      const match = findDetailByLabel(list, label);
      if (match) return match;
    }
    return undefined;
  }

  addAlias(canonicalLabel: string, alias: string) {
    // Aliases are label-level (question→label); keep them on the default variant.
    const first = this.m.get(canonicalLabel)?.[0];
    if (first && !first.aliases.includes(alias)) first.aliases.push(alias);
  }

  /** Remove a learned alias from a label (from every variant that carries it) —
   *  e.g. to un-teach a wrong question→label mapping. Matched case/punctuation-
   *  insensitively (via matchKey) since that's how the alias resolved in the first
   *  place — an exact match would miss a differently-cased stored form. */
  removeAlias(canonicalLabel: string, alias: string) {
    const n = matchKey(alias);
    for (const d of this.m.get(canonicalLabel) ?? []) {
      d.aliases = d.aliases.filter((a) => matchKey(a) !== n);
    }
  }

  remove(canonicalLabel: string) {
    this.m.delete(canonicalLabel);
  }

  /** Remove a single named variant; drops the label entirely if it was the last.
   *  Aliases live on the default (first) variant — if that's the one removed, carry
   *  them to the new default so a label's learned phrasings aren't lost. */
  removeVariant(canonicalLabel: string, variant: string) {
    const list = this.m.get(canonicalLabel);
    if (!list) return;
    const removing = list.find((x) => (x.variant ?? "") === variant);
    const filtered = list.filter((x) => (x.variant ?? "") !== variant);
    if (!filtered.length) {
      this.m.delete(canonicalLabel);
      return;
    }
    if (removing && list[0] === removing && removing.aliases.length) {
      filtered[0]!.aliases = [...new Set([...filtered[0]!.aliases, ...removing.aliases])];
    }
    this.m.set(canonicalLabel, filtered);
  }

  serialize(): string {
    return JSON.stringify([...this.m.values()].flat());
  }

  /** Load a serialized vault, degrading instead of throwing so one bad record (or a
   *  corrupt blob) can't hard-fail startup. Returns how many records were lost:
   *  -1 if the blob was unreadable (empty vault), else the count of skipped invalid
   *  entries. Callers use a non-zero result to back up / surface the corruption. */
  load(s: string): number {
    this.m = new Map();
    let details: unknown;
    try {
      details = JSON.parse(s);
    } catch {
      return -1;
    }
    if (!Array.isArray(details)) return -1;
    let dropped = 0;
    for (const d of details) {
      try {
        this.set(d as Detail);
      } catch {
        dropped++; // schema-drifted / invalid (e.g. a non-stable volatility)
      }
    }
    return dropped;
  }
}
