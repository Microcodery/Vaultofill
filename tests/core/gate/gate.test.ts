import { describe, it, expect } from "vitest";
import { evaluate } from "../../../src/core/gate/gate";
import { DEFAULT_POLICY, FilledEntry } from "../../../src/core/types";
const entry = (sensitivity: "public"|"private"|"sensitive"): FilledEntry => ({
  field: { label: "X", humanReadable: "x" }, value: "v", confidence: "certain",
  detail: { canonicalLabel: "X", value: "v", aliases: [], sensitivity, volatility: "stable" },
});
describe("Gate", () => {
  it("gates staging a sensitive entry", () =>
    expect(evaluate(entry("sensitive"), DEFAULT_POLICY)).toBe("needsConfirmation"));
  it("allows staging a public entry", () =>
    expect(evaluate(entry("public"), DEFAULT_POLICY)).toBe("allow"));
  it("allows a private entry by default (only 'sensitive' is gated)", () =>
    expect(evaluate(entry("private"), DEFAULT_POLICY)).toBe("allow"));
  it("respects a policy that gates more sensitivities", () =>
    expect(evaluate(entry("private"), { gateSensitivities: ["private", "sensitive"] })).toBe("needsConfirmation"));

  // A model-invented sensitive label (or an option control) has no stored detail,
  // so the gate must fall back to the label's default sensitivity.
  it("gates a detail-less entry whose LABEL is sensitive (invented SSN / detail-less)", () => {
    const e: FilledEntry = { field: { label: "SSN", humanReadable: "Social security number" }, value: "1", confidence: "certain" };
    expect(evaluate(e, DEFAULT_POLICY)).toBe("needsConfirmation");
  });

  it("allows a detail-less entry whose label isn't sensitive", () => {
    const e: FilledEntry = { field: { label: "FAVORITE_COLOR", humanReadable: "Favorite color" }, value: "blue", confidence: "certain" };
    expect(evaluate(e, DEFAULT_POLICY)).toBe("allow");
  });
});
