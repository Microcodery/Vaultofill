import { describe, it, expect } from "vitest";
import { buildLabelVocab } from "../../../src/core/labels/labelVocab";
import { Vault } from "../../../src/core/details/vault";
import { LabelRegistry } from "../../../src/core/labels/labelRegistry";
import { CanonicalLabel } from "../../../src/core/labels/canonicalLabels";

const BASE: CanonicalLabel[] = [
  { name: "EMAIL", description: "Email address", aliases: ["email"] },
  { name: "PHONE", description: "Telephone number", aliases: ["phone"] },
];

describe("buildLabelVocab", () => {
  it("appends the vault's accumulated aliases to the label's seed aliases", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "EMAIL", value: "a@b.com", aliases: ["work email", "e-mail"], sensitivity: "private", volatility: "stable" });
    const email = buildLabelVocab(BASE, vault).find((l) => l.name === "EMAIL")!;
    expect(email.description).toBe("Email address");
    expect(email.aliases).toEqual(["email", "work email", "e-mail"]);
  });

  it("keeps only seed aliases when no vault detail matches the label", () => {
    const vocab = buildLabelVocab(BASE, new Vault());
    expect(vocab.find((l) => l.name === "PHONE")!.aliases).toEqual(["phone"]);
  });

  it("dedupes a vault alias that already appears in the seed aliases", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "EMAIL", value: "a@b.com", aliases: ["email", "work email"], sensitivity: "private", volatility: "stable" });
    const email = buildLabelVocab(BASE, vault).find((l) => l.name === "EMAIL")!;
    expect(email.aliases).toEqual(["email", "work email"]);
  });

  it("dedupes case-insensitively, keeping the first-seen surface form", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "EMAIL", value: "a@b.com", aliases: ["Email", "Work Email"], sensitivity: "private", volatility: "stable" });
    const email = buildLabelVocab(BASE, vault).find((l) => l.name === "EMAIL")!;
    // seed "email" absorbs vault "Email"; "Work Email" is new
    expect(email.aliases).toEqual(["email", "Work Email"]);
  });

  it("includes a vault label that isn't in the seed set (a model-created one) so it's reused", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "CUMULATIVE_GPA", value: "3.9", aliases: ["cumulative gpa"], sensitivity: "private", volatility: "stable" });
    const vocab = buildLabelVocab(BASE, vault);
    const gpa = vocab.find((l) => l.name === "CUMULATIVE_GPA");
    expect(gpa).toBeDefined();
    expect(gpa!.description).toBe("cumulative gpa"); // humanized from the name
    expect(gpa!.aliases).toEqual(["cumulative gpa"]);
  });

  it("includes registry labels (invented but not value-saved) so novel labels converge across sites", () => {
    const registry = new LabelRegistry();
    registry.learn("FAVORITE_COLOR", "What is your favorite color?");
    const vocab = buildLabelVocab(BASE, new Vault(), registry);
    const fav = vocab.find((l) => l.name === "FAVORITE_COLOR");
    expect(fav).toBeDefined();
    expect(fav!.description).toBe("favorite color");
    expect(fav!.aliases).toEqual(["What is your favorite color?"]);
  });

  it("merges registry aliases into a label the vault also holds (added once)", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "VEHICLE_MAKE", value: "Toyota", aliases: ["car make"], sensitivity: "private", volatility: "stable" });
    const registry = new LabelRegistry();
    registry.learn("VEHICLE_MAKE", "Make of your vehicle");
    const vocab = buildLabelVocab(BASE, vault, registry);
    const makes = vocab.filter((l) => l.name === "VEHICLE_MAKE");
    expect(makes).toHaveLength(1); // not duplicated across vault + registry
    expect(makes[0]!.aliases).toEqual(["car make", "Make of your vehicle"]);
  });

  it("merges registry aliases into a seed label too (deduped)", () => {
    const registry = new LabelRegistry();
    registry.learn("EMAIL", "your e-mail");
    const email = buildLabelVocab(BASE, new Vault(), registry).find((l) => l.name === "EMAIL")!;
    expect(email.aliases).toEqual(["email", "your e-mail"]);
  });

  const invented = (vocab: CanonicalLabel[]): string[] =>
    vocab.map((l) => l.name).filter((n) => n !== "EMAIL" && n !== "PHONE");

  it("caps how many registry-only invented labels get injected", () => {
    const registry = new LabelRegistry();
    for (let i = 0; i < 10; i++) registry.learn(`LABEL_${i}`);
    const vocab = buildLabelVocab(BASE, new Vault(), registry, { maxInvented: 3 });
    expect(invented(vocab)).toHaveLength(3);
  });

  it("without questions, keeps the most-recently-learned invented labels", () => {
    const registry = new LabelRegistry();
    for (let i = 0; i < 5; i++) registry.learn(`LABEL_${i}`); // LABEL_4 is newest
    const vocab = buildLabelVocab(BASE, new Vault(), registry, { maxInvented: 2 });
    expect(invented(vocab)).toEqual(["LABEL_4", "LABEL_3"]); // recency desc, newest first
  });

  it("drops an old, differently-phrased relevant label once the cap is exceeded (the lexical-ranking tradeoff)", () => {
    const registry = new LabelRegistry();
    registry.learn("FAVORITE_COLOR", "What is your favorite color?"); // oldest
    for (let i = 0; i < 3; i++) registry.learn(`NEWER_${i}`, `unrelated field ${i}`);
    // "preferred colour" shares no ≥3-char token with the stored phrasing/name, so it
    // scores 0 and, past the cap, loses its slot to the newer labels → re-invented.
    const vocab = buildLabelVocab(BASE, new Vault(), registry, { questions: ["preferred colour"], maxInvented: 2 });
    expect(invented(vocab)).not.toContain("FAVORITE_COLOR");
  });

  it("a label held by both the vault and the registry does not consume an invented-cap slot", () => {
    const vault = new Vault();
    vault.set({ canonicalLabel: "VEHICLE_MAKE", value: "Toyota", aliases: [], sensitivity: "private", volatility: "stable" });
    const registry = new LabelRegistry();
    registry.learn("VEHICLE_MAKE", "car make"); // also in the vault → included as vault-backed, not via the cap
    registry.learn("SHOE_SIZE");
    registry.learn("HAT_SIZE");
    const vocab = buildLabelVocab(BASE, vault, registry, { maxInvented: 1 });
    expect(invented(vocab)).toContain("VEHICLE_MAKE"); // always in (vault-backed)
    expect(invented(vocab).filter((n) => n !== "VEHICLE_MAKE")).toHaveLength(1); // cap applies only to the registry-only tail
  });

  it("ranks invented labels relevant to the form's questions above merely-recent ones", () => {
    const registry = new LabelRegistry();
    registry.learn("VEHICLE_MAKE", "Make of your vehicle"); // relevant to the question below
    registry.learn("SHOE_SIZE", "Your shoe size"); // newer, but irrelevant
    registry.learn("FAVORITE_COLOR", "Favorite color"); // newest, irrelevant
    const vocab = buildLabelVocab(BASE, new Vault(), registry, {
      questions: ["What is the make of your vehicle?"],
      maxInvented: 1,
    });
    expect(invented(vocab)).toEqual(["VEHICLE_MAKE"]); // relevance beats recency
  });

  it("does not cap vault-backed invented labels (they're always included)", () => {
    const vault = new Vault();
    for (let i = 0; i < 5; i++) {
      vault.set({ canonicalLabel: `SAVED_${i}`, value: `v${i}`, aliases: [], sensitivity: "private", volatility: "stable" });
    }
    const vocab = buildLabelVocab(BASE, vault, new LabelRegistry(), { maxInvented: 1 });
    expect(invented(vocab).sort()).toEqual(["SAVED_0", "SAVED_1", "SAVED_2", "SAVED_3", "SAVED_4"]);
  });
});
