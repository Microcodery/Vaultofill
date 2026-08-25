// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sweepFields, countFillableFields } from "../../../src/core/form/sweepFields";

describe("sweepFields", () => {
  it("derives humanReadable from label, aria-label, and placeholder, excluding search and submit fields", () => {
    document.body.innerHTML = `
      <form>
        <label for="fn">First name</label>
        <input id="fn">
        <input aria-label="Email address" type="email">
        <input placeholder="Phone" name="phone">
        <input type="search" name="q">
        <button type="submit">Submit</button>
      </form>
    `;

    const fields = sweepFields(document);

    expect(fields).toHaveLength(3);
    expect(fields.map((f) => f.humanReadable)).toEqual([
      "First name",
      "Email address",
      "Phone",
    ]);
    for (const field of fields) {
      expect(field.elementId).toMatch(/^vof-\d+$/);
    }
  });

  it("preserves an existing data-vof id and avoids collisions when assigning new ones", () => {
    document.body.innerHTML = `
      <input data-vof="vof-0" name="existing">
      <input name="untagged">
    `;

    const fields = sweepFields(document);

    expect(fields).toHaveLength(2);
    expect(fields[0]!.elementId).toBe("vof-0");
    expect(fields[1]!.elementId).toBe("vof-1");
  });

  it("derives humanReadable from an ancestor label, excluding the control's own text", () => {
    document.body.innerHTML = `
      <label>Country
        <select>
          <option value="us">United States</option>
          <option value="ca">Canada</option>
        </select>
      </label>
    `;

    const fields = sweepFields(document);

    expect(fields).toHaveLength(1);
    expect(fields[0]!.humanReadable).toBe("Country");
  });

  it("collapses a radio group into one field, labeling options by their own text (not the shared name)", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Bed preference</legend>
        <label><input type="radio" name="bed" value="king"> King</label>
        <label><input type="radio" name="bed" value="queen"> Queen</label>
      </fieldset>
    `;
    const fields = sweepFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.humanReadable).toBe("Bed preference");
    expect(fields[0]!.control).toEqual({
      tag: "radio",
      options: [
        { value: "king", label: "King", elementId: "vof-0" },
        { value: "queen", label: "Queen", elementId: "vof-1" },
      ],
    });
  });

  it("falls back to the option value (not the group name) when a radio option has no label", () => {
    document.body.innerHTML = `<input type="radio" name="size" value="s"><input type="radio" name="size" value="m">`;
    const fields = sweepFields(document);
    expect(fields[0]!.control.options!.map((o) => o.label)).toEqual(["s", "m"]);
  });

  it("excludes hidden and off-screen fields, keeping visible ones", () => {
    document.body.innerHTML = `
      <label for="visible">Visible field</label>
      <input id="visible" name="visible">

      <label for="none">Display none field</label>
      <input id="none" name="none" style="display: none">

      <label for="offscreen">Honeypot</label>
      <input id="offscreen" name="offscreen" style="position: absolute; left: -9999px; top: -9999px">
    `;

    const fields = sweepFields(document);

    expect(fields).toHaveLength(1);
    expect(fields[0]!.humanReadable).toBe("Visible field");
  });

  it("excludes fields hidden via the hidden attribute or aria-hidden on an ancestor", () => {
    document.body.innerHTML = `
      <label for="visible">Visible field</label>
      <input id="visible" name="visible">

      <input id="hidden-attr" name="hidden-attr" hidden>

      <div aria-hidden="true">
        <label for="aria">Website</label>
        <input id="aria" name="aria">
      </div>
    `;

    const fields = sweepFields(document);

    expect(fields).toHaveLength(1);
    expect(fields[0]!.humanReadable).toBe("Visible field");
  });

  it("strips a trailing required-marker span from humanReadable", () => {
    document.body.innerHTML = `
      <label for="fn">Full name <span>*</span></label>
      <input id="fn" name="full_name">
    `;

    const fields = sweepFields(document);

    expect(fields).toHaveLength(1);
    expect(fields[0]!.humanReadable).toBe("Full name");
  });

  it("strips a trailing literal * marker with no wrapping element", () => {
    document.body.innerHTML = `
      <label for="fn">Full name *</label>
      <input id="fn" name="full_name">
    `;

    const fields = sweepFields(document);

    expect(fields).toHaveLength(1);
    expect(fields[0]!.humanReadable).toBe("Full name");
  });
});

describe("countFillableFields", () => {
  it("counts visible fillable fields, grouping radios/checkboxes by name, without mutating the DOM", () => {
    document.body.innerHTML = `
      <input name="first" placeholder="First">
      <input name="email" type="email">
      <label><input type="radio" name="bed" value="king"> King</label>
      <label><input type="radio" name="bed" value="queen"> Queen</label>
      <label><input type="checkbox" name="ame" value="wifi"> Wifi</label>
      <label><input type="checkbox" name="ame" value="pool"> Pool</label>
      <input type="search" name="q">
      <button type="submit">Go</button>
    `;
    // first + email + bed group + ame group = 4 (search/submit excluded).
    expect(countFillableFields(document)).toBe(4);
    // Non-mutating: no data-vof ids assigned (unlike sweepFields).
    expect(document.querySelector("[data-vof]")).toBeNull();
  });

  it("excludes hidden fields", () => {
    document.body.innerHTML = `
      <input name="visible">
      <input name="none" style="display: none">
      <input name="honeypot" style="position: absolute; left: -9999px">
    `;
    expect(countFillableFields(document)).toBe(1);
  });

  it("counts each nameless radio separately (no group to collapse into)", () => {
    document.body.innerHTML = `
      <label><input type="radio" value="a"> A</label>
      <label><input type="radio" value="b"> B</label>
    `;
    expect(countFillableFields(document)).toBe(2);
  });

  it("treats a radio group and a checkbox group sharing a name as two groups", () => {
    document.body.innerHTML = `
      <label><input type="radio" name="x" value="r"> R</label>
      <label><input type="checkbox" name="x" value="c"> C</label>
    `;
    expect(countFillableFields(document)).toBe(2);
  });
});
