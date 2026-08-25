import { Detail } from "../types";
import { findDetailByLabel, matchKey } from "./vault";

export class ActiveContext {
  private m = new Map<string, Detail>();

  set(key: string, d: Detail) {
    if (d.volatility === "stable") throw new Error("ActiveContext holds volatile/ephemeral only");
    this.m.set(key, d);
  }

  get(key: string) {
    return this.m.get(key);
  }

  remove(key: string) {
    this.m.delete(key);
  }

  /** Match a question/label against the session details' canonical names/aliases,
   *  so a reused volatile value (e.g. a booking date) resolves like a vault one. */
  findByLabel(label: string): Detail | undefined {
    return findDetailByLabel(this.m.values(), label);
  }

  /** Learn a confirmed question as an alias for a session detail, so a
   *  differently-phrased field resolves deterministically on the next fill. */
  addAlias(canonicalLabel: string, alias: string) {
    const d = this.m.get(canonicalLabel);
    if (d && !d.aliases.includes(alias)) d.aliases.push(alias);
  }

  /** Remove a learned alias from a session detail — un-teach a wrong mapping.
   *  Matched via matchKey (case/punctuation-insensitive), as the alias resolved. */
  removeAlias(canonicalLabel: string, alias: string) {
    const n = matchKey(alias);
    const d = this.m.get(canonicalLabel);
    if (d) d.aliases = d.aliases.filter((a) => matchKey(a) !== n);
  }

  keys() {
    return [...this.m.keys()];
  }

  clearRequest() {
    for (const [k, d] of this.m) {
      if (d.volatility === "ephemeral") this.m.delete(k);
    }
  }

  clearSession() {
    this.m.clear();
  }
}
