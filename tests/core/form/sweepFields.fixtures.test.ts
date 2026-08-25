// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sweepFields } from "../../../src/core/form/sweepFields";

// Parsed with the jsdom-environment's own DOMParser (not a fresh `new JSDOM()`)
// so the resulting elements share the ambient realm's HTMLInputElement etc.
// classes that formDetect's `instanceof` checks rely on.
function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

// The expected lists below are hand-verified snapshots of sweepFields' output
// against the real fixture markup: every humanReadable was checked against
// the visible question text on the page, and the count was checked against
// the number of meaningful fillable fields on the form (see fixture HTML).
describe("sweepFields fixtures", () => {
  it("sweeps newsletter-signup.html into its intermediate field list", () => {
    const html = readFileSync("tests/fixtures/forms/newsletter-signup.html", "utf8");
    const doc = parseHtml(html);

    const fields = sweepFields(doc);

    expect(fields).toEqual([
      { humanReadable: "Email address", elementId: "vof-0", control: { tag: "input", inputType: "email" } },
      { humanReadable: "First name", elementId: "vof-1", control: { tag: "input", inputType: "text" } },
      {
        humanReadable: "How often?",
        elementId: "vof-2",
        control: {
          tag: "radio",
          options: [
            { value: "daily", label: "Daily", elementId: "vof-2" },
            { value: "weekly", label: "Weekly", elementId: "vof-3" },
            { value: "monthly", label: "Monthly", elementId: "vof-4" },
          ],
        },
      },
      {
        humanReadable: "Topics of interest",
        elementId: "vof-5",
        control: {
          tag: "checkbox",
          options: [
            { value: "ai", label: "AI & ML", elementId: "vof-5" },
            { value: "startups", label: "Startups", elementId: "vof-6" },
            { value: "security", label: "Security", elementId: "vof-7" },
            { value: "design", label: "Design", elementId: "vof-8" },
            { value: "hardware", label: "Hardware", elementId: "vof-9" },
            { value: "culture", label: "Culture", elementId: "vof-10" },
          ],
        },
      },
      {
        humanReadable: "consent",
        elementId: "vof-11",
        control: {
          tag: "checkbox",
          options: [
            { value: "yes", label: "I agree to receive marketing emails from The Daily Ping and accept the terms.", elementId: "vof-11" },
          ],
        },
      },
    ]);
    for (const field of fields) {
      expect(field.elementId).toMatch(/^vof-\d+$/);
    }
  });

  it("sweeps hotel-reservation.html into its intermediate field list", () => {
    const html = readFileSync("tests/fixtures/forms/hotel-reservation.html", "utf8");
    const doc = parseHtml(html);

    const fields = sweepFields(doc);

    expect(fields).toEqual([
      { humanReadable: "Full name", elementId: "vof-0", control: { tag: "input", inputType: "text" } },
      { humanReadable: "Email address", elementId: "vof-1", control: { tag: "input", inputType: "email" } },
      { humanReadable: "Phone number", elementId: "vof-2", control: { tag: "input", inputType: "tel" } },
      { humanReadable: "Check-in date", elementId: "vof-3", control: { tag: "input", inputType: "date" } },
      { humanReadable: "Check-out date", elementId: "vof-4", control: { tag: "input", inputType: "date" } },
      {
        humanReadable: "Room type",
        elementId: "vof-5",
        control: {
          tag: "select",
          options: [
            { value: "", label: "Select a room type…" },
            { value: "standard", label: "Standard" },
            { value: "deluxe", label: "Deluxe" },
            { value: "suite", label: "Suite" },
          ],
        },
      },
      { humanReadable: "Number of guests", elementId: "vof-6", control: { tag: "input", inputType: "number" } },
      {
        humanReadable: "Bed preference",
        elementId: "vof-7",
        control: {
          tag: "radio",
          options: [
            { value: "king", label: "King", elementId: "vof-7" },
            { value: "queen", label: "Queen", elementId: "vof-8" },
            { value: "twin", label: "Twin", elementId: "vof-9" },
          ],
        },
      },
      { humanReadable: "Special requests (optional)", elementId: "vof-10", control: { tag: "textarea" } },
      {
        humanReadable: "cancellation_policy",
        elementId: "vof-11",
        control: {
          tag: "checkbox",
          options: [
            { value: "agreed", label: "I have read and agree to the cancellation policy.", elementId: "vof-11" },
          ],
        },
      },
    ]);
    for (const field of fields) {
      expect(field.elementId).toMatch(/^vof-\d+$/);
    }
  });
});
