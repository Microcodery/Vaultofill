// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { classify } from "../../src/core/fill/matcher";
import { persistReview } from "../../src/core/fill/persistReview";
import { ActiveContext } from "../../src/core/details/activeContext";
import { Confidence, FilledEntry, FormField } from "../../src/core/types";
import {
  FIXTURE_NAMES,
  loadFixture,
  makeKeywordModel,
  makeThrowingModel,
  seedVault,
} from "./harness";

const CONFIDENCES: Confidence[] = ["certain", "connected", "missing"];

/** Locate the classified entry the model/vault mapped to a given canonical label. */
function entryByLabel(entries: FilledEntry[], label: string): FilledEntry | undefined {
  return entries.find((e) => e.field.label === label);
}

describe("fill pipeline invariants (every form fixture)", () => {
  it.each(FIXTURE_NAMES)("sweep → classify holds structural invariants for %s", async (name) => {
    const { fields } = loadFixture(name);
    expect(fields.length).toBeGreaterThanOrEqual(1);

    const model = makeKeywordModel();
    let painted: (FilledEntry | undefined)[] | undefined;
    const entries = await classify(fields, seedVault(true), new ActiveContext(), model as never, (partial) => {
      painted = partial;
    });

    // One entry per field, in order.
    expect(entries).toHaveLength(fields.length);
    entries.forEach((entry, i) => {
      expect(entry).toBeDefined();
      expect(CONFIDENCES).toContain(entry!.confidence);
      expect(typeof entry!.field.label).toBe("string");
      // The swept element identity is preserved through classification.
      expect(entry!.field.elementId).toBe(fields[i]!.elementId);
      // A resolved (green/yellow) field always carries a value and its Detail.
      if (entry!.confidence !== "missing") {
        expect(entry!.value).not.toBeNull();
        expect(entry!.detail).toBeDefined();
      }
    });

    // Deterministic paint fired once, pre-labeling, with a slot per field.
    expect(painted).toBeDefined();
    expect(painted).toHaveLength(fields.length);
    // At most ONE labeling round-trip for the whole form (or none if all matched).
    expect(model.complete.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("seeded vault resolves common fields deterministically (no model)", () => {
  it("resolves name/email/phone to certain even when the model throws", async () => {
    const { fields } = loadFixture("hotel-reservation");
    const model = makeThrowingModel();
    const entries = await classify(fields, seedVault(true), new ActiveContext(), model as never);

    // Approach (a): with an aliased vault these resolve straight from the store,
    // green, before any LLM call — so a throwing model can't affect them.
    for (const [label, value] of [
      ["FULL_NAME", "Ada Lovelace"],
      ["EMAIL", "ada@example.com"],
      ["PHONE", "+1-555-0100"],
    ] as const) {
      expect(entryByLabel(entries, label)).toMatchObject({ confidence: "certain", value });
    }
    const certain = entries.filter((e) => e.confidence === "certain");
    expect(certain.length).toBeGreaterThanOrEqual(3);
  });
});

describe("seeded vault + model joins values on the connected path", () => {
  it("labels then fills email/phone from the vault (yellow), leaving volatile dates missing", async () => {
    const { fields } = loadFixture("hotel-reservation");
    const model = makeKeywordModel();
    // Minimal vault (no aliases): "Email address"/"Phone number" don't fold onto a
    // canonical name, so they take the LLM labeling path and resolve connected.
    const entries = await classify(fields, seedVault(false), new ActiveContext(), model as never);

    expect(entryByLabel(entries, "FULL_NAME")).toMatchObject({ confidence: "certain", value: "Ada Lovelace" });
    expect(entryByLabel(entries, "EMAIL")).toMatchObject({ confidence: "connected", value: "ada@example.com" });
    expect(entryByLabel(entries, "PHONE")).toMatchObject({ confidence: "connected", value: "+1-555-0100" });
    // Check-in maps to a volatile label the vault doesn't hold → missing, no value.
    expect(entryByLabel(entries, "START_DATE")).toMatchObject({ confidence: "missing", value: null });
    expect(model.complete).toHaveBeenCalledTimes(1);
  });
});

describe("confirming yellow matches teaches aliases (deterministic on the next fill)", () => {
  it("a re-fill resolves the previously-connected fields certain without re-asking the model", async () => {
    const { fields } = loadFixture("hotel-reservation");
    const vault = seedVault(false);
    const ctx = new ActiveContext();

    const first = await classify(fields, vault, ctx, makeKeywordModel() as never);
    const yellow = first.filter((e) => e.confidence === "connected");
    expect(yellow.length).toBeGreaterThanOrEqual(2); // at least EMAIL + PHONE

    // Persist the review, confirming the yellow rows so their questions become aliases.
    persistReview({ entries: first, confirmedYellow: yellow.map((e) => e.field) }, vault, ctx);

    const model2 = makeKeywordModel();
    const second = await classify(fields, vault, ctx, model2 as never);

    for (const label of ["EMAIL", "PHONE"]) {
      expect(entryByLabel(second, label)!.confidence).toBe("certain");
    }
    // The learned questions no longer reach the model on the second pass.
    const asked = model2.complete.mock.calls.flatMap((c) => c[0].messages.map((m: { content: string }) => m.content));
    const askedText = asked.join("\n");
    expect(askedText).not.toContain("Email address");
    expect(askedText).not.toContain("Phone number");
  });
});

describe("novel and question-derived labels for unknown fields", () => {
  it("invents learnable labels (model) and derives per-phrasing ones (UNKNOWN)", async () => {
    const { fields } = loadFixture("scholarship-application");
    const model = makeKeywordModel();
    // Alias-free vault: the personal/novel fields don't fold onto a canonical name,
    // so they all fall to the labeling stage.
    const entries = await classify(fields, seedVault(false), new ActiveContext(), model as never);

    // A model-invented, non-seed label → red, One-time (ephemeral), learnable.
    const gpa = entryByLabel(entries, "CUMULATIVE_GPA");
    expect(gpa).toMatchObject({ confidence: "missing", value: null, volatility: "ephemeral" });
    expect(gpa!.derivedLabel).toBeUndefined();

    const essay = entryByLabel(entries, "PERSONAL_ESSAY");
    expect(essay).toMatchObject({ confidence: "missing", volatility: "ephemeral" });

    // A field the model marked UNKNOWN gets a label DERIVED from its question,
    // flagged so the vocabulary won't remember a per-phrasing name.
    const derived = entries.find((e) => e.derivedLabel === true);
    expect(derived).toBeDefined();
    expect(derived!.confidence).toBe("missing");
    expect(derived!.field.label).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(derived!.volatility).toBe("ephemeral");

    // Every entry — matched or not — ends up with a non-empty label to fill under.
    for (const e of entries) expect((e.field as FormField).label.length).toBeGreaterThan(0);
  });
});
