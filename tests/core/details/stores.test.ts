import { describe, it, expect } from "vitest";
import { Vault } from "../../../src/core/details/vault";
import { ActiveContext } from "../../../src/core/details/activeContext";

describe("Vault", () => {
  it("stores stable details and round-trips", () => {
    const v = new Vault();
    v.set({ canonicalLabel: "name", value: "Ada", aliases: [], sensitivity: "private", volatility: "stable" });
    expect(v.getByCanonical("name")?.value).toBe("Ada");
    const v2 = new Vault(); v2.load(v.serialize());
    expect(v2.getByCanonical("name")?.sensitivity).toBe("private");
  });
  it("rejects non-stable details", () => {
    const v = new Vault();
    expect(() => v.set({ canonicalLabel: "x", value: "1", aliases: [], sensitivity: "public", volatility: "ephemeral" })).toThrow();
  });

  it("holds multiple named variants per label; getByCanonical returns the default (first)", () => {
    const v = new Vault();
    const base = { aliases: [], sensitivity: "private" as const, volatility: "stable" as const };
    v.set({ canonicalLabel: "EMAIL", variant: "personal", value: "me@home.com", ...base });
    v.set({ canonicalLabel: "EMAIL", variant: "work", value: "me@work.com", ...base });
    expect(v.getVariants("EMAIL").map((d) => d.variant)).toEqual(["personal", "work"]);
    expect(v.getByCanonical("EMAIL")?.value).toBe("me@home.com"); // default = first
  });

  it("upserts a variant by name and round-trips all variants", () => {
    const v = new Vault();
    const base = { aliases: [], sensitivity: "private" as const, volatility: "stable" as const };
    v.set({ canonicalLabel: "EMAIL", variant: "work", value: "old@work.com", ...base });
    v.set({ canonicalLabel: "EMAIL", variant: "work", value: "new@work.com", ...base }); // upsert same variant
    v.set({ canonicalLabel: "EMAIL", variant: "personal", value: "me@home.com", ...base });
    expect(v.getVariants("EMAIL")).toHaveLength(2);
    const v2 = new Vault();
    v2.load(v.serialize());
    expect(v2.getVariants("EMAIL").map((d) => [d.variant, d.value])).toEqual([["work", "new@work.com"], ["personal", "me@home.com"]]);
  });

  it("loads a legacy serialized vault (details without variant) as the default", () => {
    const legacy = JSON.stringify([{ canonicalLabel: "EMAIL", value: "a@b.com", aliases: [], sensitivity: "private", volatility: "stable" }]);
    const v = new Vault();
    v.load(legacy);
    expect(v.getByCanonical("EMAIL")?.value).toBe("a@b.com");
    expect(v.getVariants("EMAIL")).toHaveLength(1);
  });

  it("load degrades to an empty vault on a corrupt/non-array blob (returns -1)", () => {
    const v = new Vault();
    v.set({ canonicalLabel: "EMAIL", value: "a@b.com", aliases: [], sensitivity: "private", volatility: "stable" });
    expect(v.load("{not json")).toBe(-1);
    expect(v.keys()).toEqual([]);
    expect(v.load('{"oops":true}')).toBe(-1); // valid JSON, wrong shape
    expect(v.keys()).toEqual([]);
  });

  it("load skips a schema-invalid entry (returns the dropped count), keeping the valid ones", () => {
    const blob = JSON.stringify([
      { canonicalLabel: "EMAIL", value: "a@b.com", aliases: [], sensitivity: "private", volatility: "stable" },
      { canonicalLabel: "BAD", value: "x", aliases: [], sensitivity: "private", volatility: "ephemeral" }, // invalid for the vault
    ]);
    const v = new Vault();
    expect(v.load(blob)).toBe(1);
    expect(v.keys()).toEqual(["EMAIL"]);
  });

  it("removeVariant drops one variant, keeping the rest", () => {
    const v = new Vault();
    const base = { aliases: [], sensitivity: "private" as const, volatility: "stable" as const };
    v.set({ canonicalLabel: "EMAIL", variant: "personal", value: "a", ...base });
    v.set({ canonicalLabel: "EMAIL", variant: "work", value: "b", ...base });
    v.removeVariant("EMAIL", "personal");
    expect(v.getVariants("EMAIL").map((d) => d.variant)).toEqual(["work"]);
    v.removeVariant("EMAIL", "work");
    expect(v.getVariants("EMAIL")).toEqual([]);
  });

  it("removeAlias un-teaches a wrong mapping, matched case/punctuation-insensitively", () => {
    const v = new Vault();
    // Stored one way (as a prior site rendered it); removed with different casing/punctuation.
    v.set({ canonicalLabel: "EMAIL", value: "a@b.com", aliases: ["email", "cumulative gpa", "e-mail"], sensitivity: "private", volatility: "stable" });
    v.removeAlias("EMAIL", "Cumulative GPA"); // differs by case — matchKey-based match still removes
    v.removeAlias("EMAIL", "E Mail"); // differs by punctuation — matchKey folds "e-mail" and "E Mail"
    expect(v.getByCanonical("EMAIL")?.aliases).toEqual(["email"]);
    v.removeAlias("EMAIL", "not there"); // no-op, no throw
    expect(v.getByCanonical("EMAIL")?.aliases).toEqual(["email"]);
  });

  it("removeAlias strips the alias from every variant that carries it", () => {
    // A non-default variant can carry the alias after a load(); removal must reach it.
    const serialized = JSON.stringify([
      { canonicalLabel: "EMAIL", value: "me@home.com", aliases: ["your email"], sensitivity: "private", volatility: "stable" },
      { canonicalLabel: "EMAIL", variant: "work", value: "me@work.com", aliases: ["your email"], sensitivity: "private", volatility: "stable" },
    ]);
    const v = new Vault();
    v.load(serialized);
    v.removeAlias("EMAIL", "Your Email");
    expect(v.getVariants("EMAIL").map((d) => d.aliases)).toEqual([[], []]);
  });

  it("removeVariant of the default carries its aliases to the new default (not lost)", () => {
    const v = new Vault();
    v.set({ canonicalLabel: "EMAIL", value: "me@home.com", aliases: ["email", "your email"], sensitivity: "private", volatility: "stable" }); // default
    v.set({ canonicalLabel: "EMAIL", variant: "work", value: "me@work.com", aliases: [], sensitivity: "private", volatility: "stable" });
    v.removeVariant("EMAIL", ""); // remove the default (variant undefined → key "")
    const remaining = v.getVariants("EMAIL");
    expect(remaining.map((d) => d.variant)).toEqual(["work"]);
    expect(remaining[0]!.aliases).toEqual(["email", "your email"]); // migrated, not lost
  });
});

describe("ActiveContext", () => {
  it("clearRequest drops ephemeral, keeps volatile", () => {
    const c = new ActiveContext();
    c.set("goal", { canonicalLabel: "goal", value: "book room", aliases: [], sensitivity: "private", volatility: "volatile" });
    c.set("checkIn", { canonicalLabel: "checkIn", value: "2026-07-16", aliases: [], sensitivity: "private", volatility: "ephemeral" });
    c.clearRequest();
    expect(c.get("goal")?.value).toBe("book room");
    expect(c.get("checkIn")).toBeUndefined();
  });
  it("rejects stable details", () => {
    const c = new ActiveContext();
    expect(() => c.set("x", { canonicalLabel: "x", value: "1", aliases: [], sensitivity: "public", volatility: "stable" })).toThrow();
  });

  it("removeAlias un-teaches a session mapping, matched case/punctuation-insensitively", () => {
    const c = new ActiveContext();
    c.set("START_DATE", { canonicalLabel: "START_DATE", value: "2026-07-16", aliases: ["check-in", "departure date"], sensitivity: "private", volatility: "volatile" });
    c.removeAlias("START_DATE", "Departure Date"); // different case — must still remove (matchKey-based)
    expect(c.get("START_DATE")?.aliases).toEqual(["check-in"]);
  });
});
