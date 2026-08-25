import { describe, it, expect } from "vitest";
import { hostnameOf, partitionRestorable } from "../../../src/ext/panel/restoreTabs";

describe("hostnameOf", () => {
  it("returns the hostname of a valid URL", () => {
    expect(hostnameOf("https://sub.example.com/path?q=1")).toBe("sub.example.com");
  });

  it("returns '' for garbage and for undefined", () => {
    expect(hostnameOf("not a url")).toBe("");
    expect(hostnameOf(undefined)).toBe("");
  });
});

describe("partitionRestorable", () => {
  const restored = new Map([
    [1, { domain: "a.com" }],
    [2, { domain: "b.com" }],
    [3, { domain: "c.com" }],
  ]);

  it("restores same-domain live tabs, drops navigated ones, skips absent ones", () => {
    const live = new Map([
      [1, "a.com"], // unchanged → restore
      [2, "elsewhere.com"], // navigated while the panel was closed → drop
      // 3 not in this window → neither
    ]);
    expect(partitionRestorable(restored, live)).toEqual({ restore: [1], drop: [2] });
  });

  it("restores and drops nothing when no live tabs are known", () => {
    expect(partitionRestorable(restored, new Map())).toEqual({ restore: [], drop: [] });
  });

  it("handles an empty persisted set", () => {
    expect(partitionRestorable(new Map(), new Map([[1, "a.com"]]))).toEqual({ restore: [], drop: [] });
  });
});
