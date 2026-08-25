// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { isMeaningfulFillableField } from "../../../src/core/form/fieldDetect";

describe("isMeaningfulFillableField", () => {
  it("returns true for a plain text input", () => {
    document.body.innerHTML = `<input type="text" name="name" />`;
    const el = document.querySelector("input")!;
    expect(isMeaningfulFillableField(el)).toBe(true);
  });

  it("returns true for an input with missing type (defaults to text)", () => {
    document.body.innerHTML = `<input name="name" />`;
    const el = document.querySelector("input")!;
    expect(isMeaningfulFillableField(el)).toBe(true);
  });

  it("returns true for email and tel inputs", () => {
    document.body.innerHTML = `<input type="email" name="email" /><input type="tel" name="phone" />`;
    const [email, tel] = document.querySelectorAll("input");
    expect(isMeaningfulFillableField(email!)).toBe(true);
    expect(isMeaningfulFillableField(tel!)).toBe(true);
  });

  it("returns true for select and textarea", () => {
    document.body.innerHTML = `<select name="country"><option>US</option></select><textarea name="message"></textarea>`;
    const select = document.querySelector("select")!;
    const textarea = document.querySelector("textarea")!;
    expect(isMeaningfulFillableField(select)).toBe(true);
    expect(isMeaningfulFillableField(textarea)).toBe(true);
  });

  it("returns false for type=search", () => {
    document.body.innerHTML = `<input type="search" name="q" />`;
    const el = document.querySelector("input")!;
    expect(isMeaningfulFillableField(el)).toBe(false);
  });

  it("returns false for name=q with placeholder Search", () => {
    document.body.innerHTML = `<input type="text" name="q" placeholder="Search" />`;
    const el = document.querySelector("input")!;
    expect(isMeaningfulFillableField(el)).toBe(false);
  });

  it("returns false for an input inside <form role=search>", () => {
    document.body.innerHTML = `<form role="search"><input type="text" name="query" /></form>`;
    const el = document.querySelector("input")!;
    expect(isMeaningfulFillableField(el)).toBe(false);
  });

  it("returns false for checkbox, submit, and hidden inputs", () => {
    document.body.innerHTML = `
      <input type="checkbox" name="agree" />
      <input type="submit" value="Submit" />
      <input type="hidden" name="csrf" />
    `;
    for (const el of document.querySelectorAll("input")) {
      expect(isMeaningfulFillableField(el)).toBe(false);
    }
  });

  it("returns false for a non-form element", () => {
    document.body.innerHTML = `<div></div>`;
    const el = document.querySelector("div")!;
    expect(isMeaningfulFillableField(el)).toBe(false);
  });
});
