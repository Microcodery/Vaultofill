import { describe, it, expect } from "vitest";
import { scoreLabeling } from "../../src/eval/scoreLabeling";

describe("scoreLabeling", () => {
  it("scores a perfect match", () => {
    const s = scoreLabeling(
      { "Email address": "EMAIL", "First name": "FIRST_NAME" },
      { "Email address": "EMAIL", "First name": "FIRST_NAME" },
    );
    expect(s.accuracy).toBe(1);
    expect(s.correct).toBe(2);
    expect(s.total).toBe(2);
    expect(s.wrong).toEqual([]);
  });

  it("lists a wrong mapping with expected and got", () => {
    const s = scoreLabeling(
      { "Phone number": "PHONE", "First name": "FIRST_NAME" },
      { "Phone number": "EMAIL", "First name": "FIRST_NAME" },
    );
    expect(s.correct).toBe(1);
    expect(s.accuracy).toBe(0.5);
    expect(s.wrong).toEqual([{ question: "Phone number", expected: "PHONE", got: "EMAIL" }]);
  });

  it("counts a missing actual as wrong (UNKNOWN)", () => {
    const s = scoreLabeling({ "First name": "FIRST_NAME" }, {});
    expect(s.correct).toBe(0);
    expect(s.wrong).toEqual([{ question: "First name", expected: "FIRST_NAME", got: "UNKNOWN" }]);
  });
});
