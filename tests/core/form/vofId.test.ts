// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { VOF_INDEX_PATTERN, nextVofIndex, createVofIdAssigner } from "../../../src/core/form/vofId";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("VOF_INDEX_PATTERN", () => {
  it("matches vof-<n> and captures the index", () => {
    expect("vof-0".match(VOF_INDEX_PATTERN)?.[1]).toBe("0");
    expect("vof-42".match(VOF_INDEX_PATTERN)?.[1]).toBe("42");
  });

  it("rejects non-conforming ids", () => {
    for (const id of ["vof-", "vof-1x", "xvof-1", "vof1", "custom"]) {
      expect(VOF_INDEX_PATTERN.test(id)).toBe(false);
    }
  });
});

describe("nextVofIndex", () => {
  it("is 0 for a document with no vof ids", () => {
    document.body.innerHTML = `<input><div data-vof="custom"></div>`;
    expect(nextVofIndex(document)).toBe(0);
  });

  it("is one past the highest existing vof-<n> suffix", () => {
    document.body.innerHTML = `
      <input data-vof="vof-2">
      <input data-vof="vof-7">
      <input data-vof="not-a-vof-id">
    `;
    expect(nextVofIndex(document)).toBe(8);
  });
});

describe("createVofIdAssigner", () => {
  it("assigns sequential ids seeded past existing ones", () => {
    document.body.innerHTML = `
      <input id="tagged" data-vof="vof-3">
      <input id="a">
      <input id="b">
    `;
    const assign = createVofIdAssigner(document);

    expect(assign(document.getElementById("a")!)).toBe("vof-4");
    expect(assign(document.getElementById("b")!)).toBe("vof-5");
    expect(document.getElementById("a")!.getAttribute("data-vof")).toBe("vof-4");
  });

  it("returns an existing id untouched without consuming an index", () => {
    document.body.innerHTML = `
      <input id="tagged" data-vof="vof-1">
      <input id="a">
    `;
    const assign = createVofIdAssigner(document);

    expect(assign(document.getElementById("tagged")!)).toBe("vof-1");
    expect(assign(document.getElementById("a")!)).toBe("vof-2");
  });
});
