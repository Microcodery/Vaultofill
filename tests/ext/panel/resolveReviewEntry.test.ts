import { describe, it, expect } from "vitest";
import { resolveReviewEntry } from "../../../src/ext/panel/resolveReviewEntry";
import { volatilityFor } from "../../../src/core/labels/canonicalLabels";
import { FilledEntry, Detail, FormField } from "../../../src/core/types";

const field = (label: string, humanReadable = label): FormField => ({ label, humanReadable });
const detail = (canonicalLabel: string, value: string): Detail => ({
  canonicalLabel,
  value,
  aliases: [],
  sensitivity: "private",
  volatility: "stable",
});

const matched = (opts: Partial<FilledEntry> = {}): FilledEntry => ({
  field: field("Cumulative GPA"),
  value: "a@b.com",
  confidence: "certain",
  detail: detail("EMAIL", "a@b.com"),
  ...opts,
});

const base = { included: true as const };

describe("resolveReviewEntry", () => {
  it("no relabel: keeps the value and passes through variant/volatility", () => {
    const { entry, unlearn } = resolveReviewEntry(matched({ value: "x", detail: undefined, confidence: "connected", field: field("Email") }), {
      ...base,
      currentValue: "typed@x.com",
      chosenVariant: "work",
      volatility: "volatile",
    });
    expect(entry.value).toBe("typed@x.com");
    expect(entry.variant).toBe("work");
    expect(entry.volatility).toBe("volatile");
    expect(unlearn).toBeUndefined();
  });

  it("relabeling a matched row drops the pre-filled (wrong) value and unlearns the old alias", () => {
    // Email value sitting in a GPA field; user relabels to CUMULATIVE_GPA without editing the box.
    const { entry, unlearn } = resolveReviewEntry(matched(), { ...base, currentValue: "a@b.com", newLabelRaw: "cumulative gpa" });
    expect(entry.field.label).toBe("CUMULATIVE_GPA");
    expect(entry.detail).toBeUndefined();
    expect(entry.value).toBeNull(); // the wrong value is not persisted under the new label
    expect(unlearn).toEqual({ label: "EMAIL", alias: "Cumulative GPA" });
  });

  it("relabeling a matched row KEEPS a typed correction and re-derives volatility for the new label", () => {
    const { entry, unlearn } = resolveReviewEntry(matched({ volatility: "volatile", variant: "work" }), {
      ...base,
      currentValue: "3.8",
      newLabelRaw: "CUMULATIVE_GPA",
    });
    expect(entry.field.label).toBe("CUMULATIVE_GPA");
    expect(entry.value).toBe("3.8"); // user's correction survives
    expect(entry.volatility).toBe(volatilityFor("CUMULATIVE_GPA")); // not the old label's tier
    expect(entry.variant).toBeUndefined(); // the old variant no longer applies
    expect(unlearn).toEqual({ label: "EMAIL", alias: "Cumulative GPA" });
  });

  it("naming a red (unmatched) row keeps the typed value and has no alias to unlearn", () => {
    const red: FilledEntry = { field: field("Fun fact"), value: "", confidence: "missing" };
    const { entry, unlearn } = resolveReviewEntry(red, { ...base, currentValue: "I juggle", newLabelRaw: "FUN_FACT" });
    expect(entry.field.label).toBe("FUN_FACT");
    expect(entry.value).toBe("I juggle");
    expect(entry.confidence).toBe("certain"); // missing → certain once given a value
    expect(unlearn).toBeUndefined(); // a red row never had a match, so nothing to un-teach
  });

  it("typing junk or the same label is a no-op: no relabel, no unlearn, value untouched", () => {
    const junk = resolveReviewEntry(matched(), { ...base, currentValue: "a@b.com", newLabelRaw: "!!!" });
    expect(junk.entry.field.label).toBe("Cumulative GPA");
    expect(junk.entry.value).toBe("a@b.com");
    expect(junk.unlearn).toBeUndefined();

    const same = resolveReviewEntry(matched(), { ...base, currentValue: "a@b.com", newLabelRaw: "email" });
    expect(same.unlearn).toBeUndefined();
    expect(same.entry.value).toBe("a@b.com");
  });

  it("an excluded row persists as null regardless of relabel", () => {
    const { entry } = resolveReviewEntry(matched(), { included: false, currentValue: "a@b.com", newLabelRaw: "CUMULATIVE_GPA" });
    expect(entry.value).toBeNull();
  });
});
