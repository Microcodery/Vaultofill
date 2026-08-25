import { describe, it, expect } from "vitest";
import { shuffle, pickN, buildIteration, aggregate } from "../../../src/eval/sampling";
import { CanonicalLabel } from "../../../src/core/labels/canonicalLabels";

// Deterministic LCG so tests are stable.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const LABELS: CanonicalLabel[] = [
  { name: "EMAIL", description: "e", aliases: [] },
  { name: "FIRST_NAME", description: "f", aliases: [] },
  { name: "PHONE", description: "p", aliases: [] },
  { name: "CITY", description: "c", aliases: [] },
  { name: "COUNTRY", description: "co", aliases: [] },
];
const GOLDEN = { "Email": "EMAIL", "First name": "FIRST_NAME", "Phone": "PHONE" };

describe("shuffle/pickN", () => {
  it("pickN returns min(n, len) items, all from the source", () => {
    const out = pickN(["a", "b", "c"], 2, seeded(1));
    expect(out).toHaveLength(2);
    for (const x of out) expect(["a", "b", "c"]).toContain(x);
  });
  it("pickN clamps to array length", () => {
    expect(pickN(["a", "b"], 5, seeded(1))).toHaveLength(2);
  });
  it("shuffle keeps all elements", () => {
    expect(shuffle([1, 2, 3, 4], seeded(2)).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("buildIteration", () => {
  it("picks a question subset with matching expected labels", () => {
    const it = buildIteration(GOLDEN, LABELS, { questionCount: 2, labelCount: 4 }, seeded(3));
    expect(it.questions).toHaveLength(2);
    for (const q of it.questions) expect(it.expected[q]).toBe((GOLDEN as Record<string, string>)[q]);
  });
  it("always includes the needed labels in the vocab", () => {
    const it = buildIteration(GOLDEN, LABELS, { questionCount: 3, labelCount: 3 }, seeded(4));
    const names = new Set(it.vocab.map((l) => l.name));
    for (const q of it.questions) expect(names.has(it.expected[q]!)).toBe(true);
  });
  it("pads the vocab with distractors up to labelCount", () => {
    const it = buildIteration(GOLDEN, LABELS, { questionCount: 1, labelCount: 4 }, seeded(5));
    expect(it.vocab).toHaveLength(4);
  });
});

describe("aggregate", () => {
  it("computes per-question accuracy sorted worst-first", () => {
    const m = new Map([
      ["good", { correct: 10, seen: 10 }],
      ["bad", { correct: 2, seen: 10 }],
      ["mid", { correct: 5, seen: 10 }],
    ]);
    const stats = aggregate(m);
    expect(stats.map((s) => s.question)).toEqual(["bad", "mid", "good"]);
    expect(stats[0]!.accuracy).toBeCloseTo(0.2);
  });
});
