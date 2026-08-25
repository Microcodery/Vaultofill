import { describe, it, expect } from "vitest";
import { LabelRegistry } from "../../../src/core/labels/labelRegistry";

describe("LabelRegistry", () => {
  it("remembers labels with their question phrasings, deduping aliases matchKey-wise", () => {
    const r = new LabelRegistry();
    r.learn("FAVORITE_COLOR", "What is your favorite color?");
    r.learn("FAVORITE_COLOR", "what is your favorite color"); // same matchKey → not added again
    r.learn("FAVORITE_COLOR", "Preferred colour"); // distinct
    r.learn("VEHICLE_MAKE"); // name only, no alias

    const fav = r.entries().find((e) => e.name === "FAVORITE_COLOR")!;
    expect(fav.aliases).toEqual(["What is your favorite color?", "Preferred colour"]);
    expect(r.entries().find((e) => e.name === "VEHICLE_MAKE")!.aliases).toEqual([]);
  });

  it("ignores empty names and empty/whitespace aliases", () => {
    const r = new LabelRegistry();
    r.learn("");
    r.learn("X", "   ");
    expect(r.entries()).toEqual([{ name: "X", aliases: [] }]);
  });

  it("remove un-remembers a label", () => {
    const r = new LabelRegistry();
    r.learn("A", "a");
    r.learn("B", "b");
    r.remove("A");
    expect(r.entries().map((e) => e.name)).toEqual(["B"]);
  });

  it("round-trips through serialize/load", () => {
    const r = new LabelRegistry();
    r.learn("FAVORITE_COLOR", "favorite color");
    r.learn("VEHICLE_MAKE");
    const r2 = new LabelRegistry();
    r2.load(r.serialize());
    expect(r2.entries()).toEqual(r.entries());
  });

  it("load degrades to empty on a corrupt blob", () => {
    const r = new LabelRegistry();
    r.learn("A", "a");
    r.load("{not json");
    expect(r.entries()).toEqual([]);
  });

  it("evicts the least-recently-learned label past the cap", () => {
    const r = new LabelRegistry(2);
    r.learn("A");
    r.learn("B");
    r.learn("C"); // over cap → oldest (A) evicted
    expect(r.entries().map((e) => e.name)).toEqual(["B", "C"]);
  });

  it("re-learning an existing label refreshes its recency (isn't evicted as stale)", () => {
    const r = new LabelRegistry(2);
    r.learn("A");
    r.learn("B");
    r.learn("A", "again"); // A back to newest → B is now the oldest
    r.learn("C"); // evicts B, not A
    expect(r.entries().map((e) => e.name)).toEqual(["A", "C"]);
  });

  it("trims to the cap on load (e.g. a blob written under a higher cap)", () => {
    const big = new LabelRegistry(10);
    big.learn("A");
    big.learn("B");
    big.learn("C");
    const small = new LabelRegistry(2);
    small.load(big.serialize());
    expect(small.entries().map((e) => e.name)).toEqual(["B", "C"]); // oldest dropped
  });

  describe("dedupe", () => {
    it("merges two names given to the same question phrasing, keeping the richer one", () => {
      const r = new LabelRegistry();
      r.learn("FAVORITE_COLOR", "What is your favorite color?");
      r.learn("FAVORITE_COLOR", "Preferred colour"); // richer: 2 aliases
      r.learn("FAV_COLOR", "What is your favorite color?"); // same phrasing → dup
      expect(r.dedupe()).toBe(1);
      expect(r.entries().map((e) => e.name)).toEqual(["FAVORITE_COLOR"]);
      expect(r.entries()[0]!.aliases).toEqual(["What is your favorite color?", "Preferred colour"]);
      expect(r.dedupe()).toBe(0); // idempotent
    });

    it("merges names with the same token-set (reordered words), even with no shared alias", () => {
      const r = new LabelRegistry();
      r.learn("HOME_PHONE", "home phone");
      r.learn("PHONE_HOME", "phone at home");
      expect(r.dedupe()).toBe(1);
      const names = r.entries().map((e) => e.name);
      expect(names).toHaveLength(1);
      expect(r.entries()[0]!.aliases).toEqual(["home phone", "phone at home"]);
    });

    it("does not merge labels that merely share a token", () => {
      const r = new LabelRegistry();
      r.learn("EYE_COLOR", "eye color");
      r.learn("COLOR_PREFERENCE", "preferred color"); // shares "color" only → distinct concepts
      expect(r.dedupe()).toBe(0);
      expect(r.entries().map((e) => e.name).sort()).toEqual(["COLOR_PREFERENCE", "EYE_COLOR"]);
    });

    it("does not merge distinct concepts that share only a single generic phrasing", () => {
      const r = new LabelRegistry();
      r.learn("COMPANY_NAME", "Name");
      r.learn("CONTACT_NAME", "Name"); // same lone word "name" — too generic to merge on
      expect(r.dedupe()).toBe(0);
      expect(r.entries().map((e) => e.name).sort()).toEqual(["COMPANY_NAME", "CONTACT_NAME"]);
    });

    it("keeps the label with more aliases as canonical even when learned later", () => {
      const r = new LabelRegistry();
      r.learn("FAV_COLOR", "top colour");
      r.learn("FAVORITE_COLOR", "top colour"); // shared alias → merges
      r.learn("FAVORITE_COLOR", "favorite color of choice"); // now the richer one
      expect(r.dedupe()).toBe(1);
      expect(r.entries().map((e) => e.name)).toEqual(["FAVORITE_COLOR"]);
    });

    it("promotes a merged concept to its group's most-recent slot (not left evictable)", () => {
      const r = new LabelRegistry();
      r.learn("FAVORITE_COLOR", "favorite color"); // oldest
      r.learn("SHOE_SIZE", "shoe size");
      r.learn("FAV_COLOR", "favorite color"); // newest; dup of FAVORITE_COLOR
      r.dedupe();
      // FAVORITE_COLOR survives but inherits its group's newest position (after SHOE_SIZE).
      expect(r.entries().map((e) => e.name)).toEqual(["SHOE_SIZE", "FAVORITE_COLOR"]);
    });

    it("returns 0 on an empty registry and for distinct single-token names", () => {
      const r = new LabelRegistry();
      expect(r.dedupe()).toBe(0);
      r.learn("COLOR", "a colour");
      r.learn("SIZE", "a size");
      expect(r.dedupe()).toBe(0);
      expect(r.entries().map((e) => e.name).sort()).toEqual(["COLOR", "SIZE"]);
    });

    it("merges transitively across the alias and token-set signals", () => {
      const r = new LabelRegistry();
      r.learn("FAVORITE_COLOR", "favorite color"); // A
      r.learn("FAV_COLOR", "favorite color"); // B ~ A (shared alias)
      r.learn("COLOR_FAV", "top colour"); // C ~ B (same token-set as FAV_COLOR)
      expect(r.dedupe()).toBe(2);
      expect(r.entries()).toHaveLength(1);
    });

    it("runs automatically on load, self-healing a blob with accumulated dupes", () => {
      const serialized = JSON.stringify([
        ["FAVORITE_COLOR", ["What is your favorite color?"]],
        ["FAV_COLOR", ["What is your favorite color?"]],
      ]);
      const r = new LabelRegistry();
      r.load(serialized);
      expect(r.entries().map((e) => e.name)).toEqual(["FAVORITE_COLOR"]);
    });
  });
});
