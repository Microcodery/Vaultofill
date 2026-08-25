import { describe, it, expect } from "vitest";
import { persistReview } from "../../../src/core/fill/persistReview";
import { Vault } from "../../../src/core/details/vault";
import { ActiveContext } from "../../../src/core/details/activeContext";
import { LabelRegistry } from "../../../src/core/labels/labelRegistry";
import { FilledEntry, FormField, Volatility } from "../../../src/core/types";

// persistReview is the shared persist step the panel's re-usable review calls
// directly on each Fill click.
describe("persistReview label learning (open-set convergence)", () => {
  const filled = (label: string, question: string, volatility: Volatility): FilledEntry => ({
    field: { label, humanReadable: question },
    value: "x",
    confidence: "certain",
    volatility,
  });

  it("remembers a model-invented novel label even at One-time (value NOT saved, label IS)", () => {
    const vault = new Vault();
    const registry = new LabelRegistry();
    persistReview({ entries: [filled("FAVORITE_COLOR", "What is your favorite color?", "ephemeral")], confirmedYellow: [] }, vault, new ActiveContext(), registry);
    expect(vault.getByCanonical("FAVORITE_COLOR")).toBeUndefined(); // One-time → value not persisted
    expect(registry.entries()).toEqual([{ name: "FAVORITE_COLOR", aliases: ["What is your favorite color?"] }]); // label remembered
  });

  it("does NOT remember a question-derived fallback label (marked by the matcher) — it'd bloat the vocab", () => {
    const registry = new LabelRegistry();
    const derived: FilledEntry = { ...filled("REFERRAL_CODE", "Referral code", "ephemeral"), derivedLabel: true };
    persistReview({ entries: [derived], confirmedYellow: [] }, new Vault(), new ActiveContext(), registry);
    expect(registry.entries()).toEqual([]);
  });

  it("remembers a terse model-invention even though it equals the normalized question (no derivedLabel flag)", () => {
    // "Vehicle make" → VEHICLE_MAKE happens to equal toCanonicalLabel(question), but the
    // MODEL invented it (no derivedLabel), so it must still be remembered for convergence.
    const registry = new LabelRegistry();
    persistReview({ entries: [filled("VEHICLE_MAKE", "Vehicle make", "ephemeral")], confirmedYellow: [] }, new Vault(), new ActiveContext(), registry);
    expect(registry.entries()).toEqual([{ name: "VEHICLE_MAKE", aliases: ["Vehicle make"] }]);
  });

  it("does NOT remember a seed label (already in the vocab)", () => {
    const registry = new LabelRegistry();
    persistReview({ entries: [filled("EMAIL", "Your email", "stable")], confirmedYellow: [] }, new Vault(), new ActiveContext(), registry);
    expect(registry.entries()).toEqual([]);
  });

  it("does NOT re-learn a label already saved stable in the vault (surfaces via the vault; avoid double-booking)", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "VEHICLE_MAKE", value: "Toyota", aliases: ["car make"], sensitivity: "private", volatility: "stable" });
    const registry = new LabelRegistry();
    persistReview({ entries: [filled("VEHICLE_MAKE", "Manufacturer of your car", "stable")], confirmedYellow: [] }, vault, new ActiveContext(), registry);
    expect(registry.entries()).toEqual([]);
  });

  it("no registry passed → no learning, no throw (backward compatible)", () => {
    expect(() =>
      persistReview({ entries: [filled("FOO_BAR", "Foo bar thing", "stable")], confirmedYellow: [] }, new Vault(), new ActiveContext()),
    ).not.toThrow();
  });

  it("prunes a registry label once its value is saved stable in the vault (so dedupe can't orphan the value)", () => {
    const vault = new Vault();
    const registry = new LabelRegistry();
    registry.learn("FAVORITE_COLOR", "What is your favorite color?"); // remembered earlier at One-time
    persistReview({ entries: [filled("FAVORITE_COLOR", "Favorite color", "stable")], confirmedYellow: [] }, vault, new ActiveContext(), registry);
    expect(vault.getByCanonical("FAVORITE_COLOR")).toBeDefined(); // value now saved
    expect(registry.entries()).toEqual([]); // redundant registry entry pruned (surfaces via the vault now)
  });
});

describe("persistReview", () => {
  it("persists a stable value to the vault and dedupes a canonical label filled twice", () => {
    const vault = new Vault();
    const ctx = new ActiveContext();
    const entries: FilledEntry[] = [
      { field: { label: "EMAIL", humanReadable: "Email" }, value: "a@b.com", confidence: "certain", volatility: "stable" },
      { field: { label: "EMAIL", humanReadable: "Confirm email" }, value: "IGNORED", confidence: "certain", volatility: "stable" },
    ];
    persistReview({ entries, confirmedYellow: [] }, vault, ctx);
    // Only the first EMAIL is persisted (dedup by label+variant); the value sticks.
    expect(vault.getByCanonical("EMAIL")?.value).toBe("a@b.com");
    expect(vault.getVariants("EMAIL")).toHaveLength(1);
  });

  it("a One-time fill with no owned detail leaves a different stored value with the same label intact", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "MOTHERS_NAME", value: "Ada", aliases: [], sensitivity: "private", volatility: "stable" });
    const ctx = new ActiveContext();
    // A question-derived fallback red normalized to MOTHERS_NAME but never matched
    // the stored value (detail unset) and defaults to One-time (ephemeral). It must
    // NOT wipe the saved value — the ephemeral remove is only for demoting an owned
    // (matched) value.
    const entries: FilledEntry[] = [
      { field: { label: "MOTHERS_NAME", humanReadable: "Mother's name" }, value: "typed", confidence: "certain", volatility: "ephemeral" },
    ];
    persistReview({ entries, confirmedYellow: [] }, vault, ctx);
    expect(vault.getByCanonical("MOTHERS_NAME")?.value).toBe("Ada"); // not wiped
  });

  it("a One-time demotion of an OWNED (matched) value does remove its stored copy", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "GOAL", value: "old", aliases: [], sensitivity: "private", volatility: "stable" });
    const ctx = new ActiveContext();
    const detail = vault.getByCanonical("GOAL");
    // Matched row (entry.detail set) the user demoted to One-time → its stored copy goes.
    const entries: FilledEntry[] = [{ field: { label: "GOAL", humanReadable: "Goal" }, value: "new", confidence: "certain", detail, volatility: "ephemeral" }];
    persistReview({ entries, confirmedYellow: [] }, vault, ctx);
    expect(vault.getByCanonical("GOAL")).toBeUndefined();
  });

  it("stores an option control's selected value(s) as portable label(s)", () => {
    const vault = new Vault();
    const ctx = new ActiveContext();
    const bed: FormField = {
      label: "BED_PREFERENCE", humanReadable: "Bed",
      control: { tag: "radio", options: [{ value: "1", label: "Two Doubles" }, { value: "2", label: "King" }] },
    };
    const amenities: FormField = {
      label: "AMENITIES", humanReadable: "Amenities",
      control: { tag: "checkbox", options: [{ value: "a", label: "AC" }, { value: "w", label: "Wifi" }, { value: "p", label: "Pool" }] },
    };
    const entries: FilledEntry[] = [
      { field: bed, value: "2", confidence: "certain", volatility: "stable" }, // site value "2"
      { field: amenities, value: "a\nw", confidence: "certain", volatility: "stable" }, // site values
    ];
    persistReview({ entries, confirmedYellow: [] }, vault, ctx);
    expect(vault.getByCanonical("BED_PREFERENCE")?.value).toBe("King"); // label, not "2"
    expect(vault.getByCanonical("AMENITIES")?.value).toBe("AC\nWifi"); // labels, not "a\nw"
  });

  it("learns a confirmed-yellow question as an alias in the owning store", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "EMAIL", value: "a@b.com", aliases: [], sensitivity: "private", volatility: "stable" });
    const ctx = new ActiveContext();
    const field: FormField = { label: "EMAIL", humanReadable: "Your work e-mail" };
    const entries: FilledEntry[] = [{ field, value: "a@b.com", confidence: "connected", detail: vault.getByCanonical("EMAIL"), volatility: "stable" }];
    persistReview({ entries, confirmedYellow: [field] }, vault, ctx);
    expect(vault.getByCanonical("EMAIL")?.aliases).toContain("Your work e-mail");
  });

  it("is idempotent — calling it again doesn't duplicate the alias or variant", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "EMAIL", value: "a@b.com", aliases: [], sensitivity: "private", volatility: "stable" });
    const ctx = new ActiveContext();
    const field: FormField = { label: "EMAIL", humanReadable: "Email" };
    const review = { entries: [{ field, value: "a@b.com", confidence: "connected" as const, detail: vault.getByCanonical("EMAIL"), volatility: "stable" as const }], confirmedYellow: [field] };
    persistReview(review, vault, ctx);
    persistReview(review, vault, ctx);
    expect(vault.getByCanonical("EMAIL")?.aliases).toEqual(["Email"]);
    expect(vault.getVariants("EMAIL")).toHaveLength(1);
  });
});
