// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { findSubmit } from "../../../src/core/form/findSubmit";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("findSubmit", () => {
  it("prefers an explicit submit control and assigns it a data-vof id", () => {
    document.body.innerHTML = `
      <form>
        <button type="button">Cancel</button>
        <button type="submit">Save</button>
      </form>
    `;
    const spec = findSubmit(document);
    expect(spec).toEqual({ kind: "dom", elementId: expect.stringMatching(/^vof-\d+$/) });
    const submit = document.querySelector('button[type="submit"]')!;
    expect(submit.getAttribute("data-vof")).toBe(spec!.kind === "dom" ? spec!.elementId : "");
  });

  it("treats a typeless <button> as submit when no explicit submit exists", () => {
    document.body.innerHTML = `<form><input><button>Continue</button></form>`;
    const spec = findSubmit(document);
    const button = document.querySelector("button")!;
    expect(spec).toMatchObject({ kind: "dom", elementId: button.getAttribute("data-vof") });
  });

  it("falls back to a button whose text reads like a submit action", () => {
    document.body.innerHTML = `
      <div>
        <button type="button">Add photo</button>
        <button type="button">Book now</button>
      </div>
    `;
    const spec = findSubmit(document);
    const booking = [...document.querySelectorAll("button")].find((b) => b.textContent === "Book now")!;
    expect(spec).toMatchObject({ kind: "dom", elementId: booking.getAttribute("data-vof") });
  });

  it("returns null when there is no submit-like control", () => {
    document.body.innerHTML = `<form><input><button type="button">Add photo</button></form>`;
    expect(findSubmit(document)).toBeNull();
  });

  it("ignores a typeless button outside any form (e.g. a nav toggle)", () => {
    document.body.innerHTML = `
      <nav><button>Menu</button></nav>
      <form><input><button>Continue</button></form>
    `;
    const spec = findSubmit(document);
    const formButton = document.querySelector("form button")!;
    expect(spec).toMatchObject({ kind: "dom", elementId: formButton.getAttribute("data-vof") });
  });

  it("preserves an existing data-vof id and seeds new ids past the highest index", () => {
    document.body.innerHTML = `
      <form>
        <input data-vof="vof-7">
        <button type="submit">Go</button>
      </form>
    `;
    const spec = findSubmit(document);
    expect(spec).toEqual({ kind: "dom", elementId: "vof-8" });
  });

  it("reuses the submit control's own data-vof id when it already has one", () => {
    document.body.innerHTML = `<form><button type="submit" data-vof="vof-3">Go</button></form>`;
    expect(findSubmit(document)).toEqual({ kind: "dom", elementId: "vof-3" });
  });
});
