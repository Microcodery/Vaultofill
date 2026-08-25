import { describe, it, expect } from "vitest";
import { scoreConvergence, scoreUnknown } from "../../src/eval/scoreOpenSet";

describe("scoreConvergence", () => {
  const groups = [{ concept: "color", phrasings: ["fav color", "preferred colour"] }];

  it("converges when all phrasings map to one non-UNKNOWN label", () => {
    const s = scoreConvergence(groups, { "fav color": "FAVORITE_COLOR", "preferred colour": "FAVORITE_COLOR" });
    expect(s.converged).toBe(1);
    expect(s.rate).toBe(1);
    expect(s.detail[0]!.labels).toEqual(["FAVORITE_COLOR"]);
  });

  it("does not converge when phrasings diverge (the drift the registry fixes)", () => {
    const s = scoreConvergence(groups, { "fav color": "FAVORITE_COLOR", "preferred colour": "COLOR_PREF" });
    expect(s.converged).toBe(0);
    expect(s.detail[0]!.labels.sort()).toEqual(["COLOR_PREF", "FAVORITE_COLOR"]);
  });

  it("all-UNKNOWN does not count as converged", () => {
    expect(scoreConvergence(groups, { "fav color": "UNKNOWN", "preferred colour": "UNKNOWN" }).converged).toBe(0);
  });

  it("a missing actual entry defaults to UNKNOWN (so it can't spuriously converge)", () => {
    expect(scoreConvergence(groups, { "fav color": "FAVORITE_COLOR" }).converged).toBe(0);
  });

  it("computes a fractional rate across multiple groups", () => {
    const two = [
      { concept: "color", phrasings: ["a", "b"] },
      { concept: "make", phrasings: ["c", "d"] },
    ];
    const s = scoreConvergence(two, { a: "FAVORITE_COLOR", b: "FAVORITE_COLOR", c: "VEHICLE_MAKE", d: "CAR_MAKE" });
    expect(s.converged).toBe(1); // color converges, make diverges
    expect(s.rate).toBe(0.5);
  });

  it("empty groups → rate 1", () => {
    expect(scoreConvergence([], {}).rate).toBe(1);
  });
});

describe("scoreUnknown", () => {
  it("scores both error directions and surfaces force-fit non-fillable labels", () => {
    const nonFillable = ["captcha", "search"];
    const fillable = ["email", "color"];
    const actual = { captcha: "UNKNOWN", search: "SEARCH_QUERY", email: "EMAIL", color: "UNKNOWN" };
    const s = scoreUnknown(nonFillable, fillable, actual);
    expect(s.caughtUnknown).toBe(1); // only captcha
    expect(s.unknownRecall).toBe(0.5);
    expect(s.wronglyLabeled).toEqual(["search"]); // the bloat/force-fit failure
    expect(s.labeled).toBe(1); // only email
    expect(s.fillableCoverage).toBe(0.5);
    expect(s.wronglyUnknown).toEqual(["color"]);
  });

  it("perfect run → recall & coverage 1, no wrong lists", () => {
    const s = scoreUnknown(["captcha"], ["email"], { captcha: "UNKNOWN", email: "EMAIL" });
    expect(s.unknownRecall).toBe(1);
    expect(s.fillableCoverage).toBe(1);
    expect(s.wronglyLabeled).toEqual([]);
    expect(s.wronglyUnknown).toEqual([]);
  });

  it("empty sets → 1", () => {
    const s = scoreUnknown([], [], {});
    expect(s.unknownRecall).toBe(1);
    expect(s.fillableCoverage).toBe(1);
  });
});
