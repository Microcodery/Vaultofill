import { describe, it, expect } from "vitest";
import { sortByConfidence } from "../../../src/ext/panel/sortEntries";
import { FilledEntry } from "../../../src/core/types";

const entry = (label: string, confidence: FilledEntry["confidence"]): FilledEntry => ({
  field: { label, humanReadable: label },
  value: confidence === "missing" ? null : "v",
  confidence,
});

describe("sortByConfidence", () => {
  it("orders missing, then connected, then certain", () => {
    const entries = [entry("a", "certain"), entry("b", "missing"), entry("c", "connected")];
    const sorted = sortByConfidence(entries);
    expect(sorted.map(e => e.field.label)).toEqual(["b", "c", "a"]);
  });

  it("is stable within a confidence group", () => {
    const entries = [
      entry("cert1", "certain"),
      entry("conn1", "connected"),
      entry("cert2", "certain"),
      entry("conn2", "connected"),
      entry("miss1", "missing"),
    ];
    const sorted = sortByConfidence(entries);
    expect(sorted.map(e => e.field.label)).toEqual(["miss1", "conn1", "conn2", "cert1", "cert2"]);
  });

  it("does not mutate the input array", () => {
    const entries = [entry("a", "certain"), entry("b", "missing")];
    const original = [...entries];
    sortByConfidence(entries);
    expect(entries).toEqual(original);
  });

  it("returns an empty array for no entries", () => {
    expect(sortByConfidence([])).toEqual([]);
  });
});
