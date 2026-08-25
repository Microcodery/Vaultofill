// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { isVisibleField } from "../../../src/core/form/visibility";

// hidden attribute, aria-hidden ancestors, display:none, and off-screen
// positioning are already exercised through the sweepFields tests; these cover
// the remaining computed-style cases and the detached-document fallback.
beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isVisibleField", () => {
  it("treats visibility:hidden and opacity:0 as hidden", () => {
    document.body.innerHTML = `
      <input id="vis" style="visibility: hidden">
      <input id="opa" style="opacity: 0">
      <input id="ok">
    `;
    expect(isVisibleField(document.getElementById("vis")!, document)).toBe(false);
    expect(isVisibleField(document.getElementById("opa")!, document)).toBe(false);
    expect(isVisibleField(document.getElementById("ok")!, document)).toBe(true);
  });

  it("falls back to attribute-only checks for a detached document with no view", () => {
    const doc = new DOMParser().parseFromString(
      `<input id="styled" style="display: none"><input id="attr" hidden>`,
      "text/html",
    );
    expect(doc.defaultView).toBeNull();
    expect(isVisibleField(doc.getElementById("styled")!, doc)).toBe(true);
    expect(isVisibleField(doc.getElementById("attr")!, doc)).toBe(false);
  });
});
