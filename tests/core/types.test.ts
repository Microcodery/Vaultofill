import { describe, it, expect } from "vitest";
import { DEFAULT_POLICY } from "../../src/core/types";
import type { Detail, FormSchema, FilledEntry } from "../../src/core/types";
describe("types", () => {
  it("default policy gates sensitive fields", () => {
    expect(DEFAULT_POLICY.gateSensitivities).toEqual(["sensitive"]);
  });
});

describe("v2 types", () => {
  it("Detail carries canonicalLabel + aliases; FilledEntry carries confidence", () => {
    const d: Detail = { canonicalLabel: "FIRST_NAME", value: "Ada", aliases: ["forename"], sensitivity: "private", volatility: "stable" };
    const schema: FormSchema = { fields: [{ label: "FIRST_NAME", humanReadable: "First name?", elementId: "e1" }], submit: { kind: "dom", elementId: "sub" } };
    const entry: FilledEntry = { field: schema.fields[0]!, value: d.value, confidence: "certain", detail: d };
    expect(entry.confidence).toBe("certain");
  });
});
