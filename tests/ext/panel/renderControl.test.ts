// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildControl, buildTierBadge, buildVariantCombobox, buildRowMenu, buildMenuSection } from "../../../src/ext/panel/renderControl";

describe("buildTierBadge", () => {
  it("shows the current tier and cycles Permanent → Temporary → One-time on click", () => {
    const badge = buildTierBadge("stable");
    expect(badge.element.textContent).toBe("Permanent");
    expect(badge.element.dataset.tier).toBe("stable");
    expect(badge.getValue()).toBe("stable");

    badge.element.click();
    expect(badge.getValue()).toBe("volatile");
    expect(badge.element.textContent).toBe("Temporary");
    badge.element.click();
    expect(badge.getValue()).toBe("ephemeral");
    badge.element.click(); // wraps back around
    expect(badge.getValue()).toBe("stable");
  });

  it("setValue re-seeds the tier", () => {
    const badge = buildTierBadge("stable");
    badge.setValue("volatile");
    expect(badge.getValue()).toBe("volatile");
    expect(badge.element.dataset.tier).toBe("volatile");
  });
});

describe("buildVariantCombobox", () => {
  it("lists the variants as datalist suggestions (value + variant label)", () => {
    const c = buildVariantCombobox(
      [{ variant: "personal", value: "me@home.com" }, { variant: "work", value: "me@work.com" }],
      "me@home.com",
      "personal",
    );
    const input = c.element.querySelector("input")!;
    const options = [...c.element.querySelectorAll("datalist option")] as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(["me@home.com", "me@work.com"]);
    expect(options.map((o) => o.label)).toEqual(["personal", "work"]);
    expect(input.getAttribute("list")).toBe(c.element.querySelector("datalist")!.id);
    expect(c.getValue()).toBe("me@home.com");
    expect(c.getVariant()).toBe("personal");
  });

  it("selects the variant whose value the user types/picks", () => {
    const c = buildVariantCombobox(
      [{ variant: "personal", value: "me@home.com" }, { variant: "work", value: "me@work.com" }],
      "me@home.com",
      "personal",
    );
    const input = c.element.querySelector("input")!;
    input.value = "me@work.com";
    input.dispatchEvent(new Event("input"));
    expect(c.getVariant()).toBe("work");
    expect(c.getValue()).toBe("me@work.com");
  });

  it("keeps the current variant when the value is edited to a non-matching one", () => {
    const c = buildVariantCombobox([{ variant: "work", value: "me@work.com" }], "me@work.com", "work");
    const input = c.element.querySelector("input")!;
    input.value = "new@work.com"; // edit of the work variant's value
    input.dispatchEvent(new Event("input"));
    expect(c.getVariant()).toBe("work");
  });
});

describe("buildRowMenu / buildMenuSection", () => {
  it("toggles the panel open/closed on trigger click", () => {
    const menu = buildRowMenu();
    document.body.append(menu.trigger, menu.panel);
    expect(menu.panel.classList.contains("open")).toBe(false);
    menu.trigger.click();
    expect(menu.panel.classList.contains("open")).toBe(true);
    menu.trigger.click();
    expect(menu.panel.classList.contains("open")).toBe(false);
    menu.trigger.remove();
    menu.panel.remove();
  });

  it("builds a titled section", () => {
    const section = buildMenuSection("Save as new variant");
    expect(section.querySelector(".vof-menu-heading")!.textContent).toBe("Save as new variant");
  });
});

describe("buildControl", () => {
  it("mirrors a select with the same options and selects the value", () => {
    const c = buildControl(
      { tag: "select", options: [{ value: "standard", label: "Standard" }, { value: "deluxe", label: "Deluxe" }] },
      "deluxe",
    );
    expect(c.element.tagName).toBe("SELECT");
    expect([...(c.element as HTMLSelectElement).options].map((o) => o.value)).toEqual(["standard", "deluxe"]);
    expect(c.getValue()).toBe("deluxe");
  });

  it("selects a select option by its visible label when the value isn't an option value", () => {
    const c = buildControl({ tag: "select", options: [{ value: "deluxe", label: "Deluxe" }] }, "Deluxe");
    expect(c.getValue()).toBe("deluxe");
  });

  it("selects a select option by its label case-insensitively (portable preference across sites)", () => {
    // Stored preference holds the label "King"; this site's option is differently
    // cased/valued, but it still resolves to that option (getValue → site value).
    const c = buildControl({ tag: "select", options: [{ value: "opt2", label: "KING" }] }, "King");
    expect(c.getValue()).toBe("opt2");
  });

  it("radio/checkbox seed by option label too, so a stored label checks the right option", () => {
    const radio = buildControl(
      { tag: "radio", options: [{ value: "1", label: "Two Doubles" }, { value: "2", label: "King" }] },
      "King", // stored label, not the "2" value
    );
    expect(radio.getValue()).toBe("2"); // resolves to this site's option value

    const checks = buildControl(
      { tag: "checkbox", options: [{ value: "a", label: "AC" }, { value: "w", label: "Wifi" }, { value: "p", label: "Pool" }] },
      "AC\nPool", // stored labels
    );
    expect(checks.getValue()).toBe("a\np");
  });

  it("a choice token checks at most one option, preferring label over a colliding value", () => {
    // Option A's value ("pool") equals option B's label ("Pool"); seeding the
    // stored label "Pool" must check only B, not both.
    const c = buildControl(
      { tag: "checkbox", options: [{ value: "pool", label: "Swimming" }, { value: "sw", label: "Pool" }] },
      "Pool",
    );
    expect(c.getValue()).toBe("sw");
  });

  it("injects a value that matches no option so it's still shown", () => {
    const c = buildControl({ tag: "select", options: [{ value: "standard", label: "Standard" }] }, "Penthouse");
    const select = c.element as HTMLSelectElement;
    expect(select.options[0]!.value).toBe("Penthouse");
    expect(c.getValue()).toBe("Penthouse");
  });

  it("an unfilled select resolves to \"\" (blank option), not the first option's value", () => {
    // Without this, a missing select would silently submit its first option
    // (e.g. a country dropdown defaulting to 'United States').
    const c = buildControl({ tag: "select", options: [{ value: "us", label: "United States" }, { value: "ca", label: "Canada" }] }, "");
    expect(c.getValue()).toBe("");
    expect((c.element as HTMLSelectElement).options[0]!.value).toBe("");
  });

  it("reuses an existing blank option for an unfilled select instead of adding another", () => {
    const c = buildControl({ tag: "select", options: [{ value: "", label: "Choose…" }, { value: "us", label: "United States" }] }, "");
    expect(c.getValue()).toBe("");
    expect((c.element as HTMLSelectElement).options).toHaveLength(2); // no extra blank injected
  });

  it("keeps a disabled select seeded and readable", () => {
    const c = buildControl({ tag: "select", options: [{ value: "deluxe", label: "Deluxe" }] }, "deluxe", { disabled: true });
    expect((c.element as HTMLSelectElement).disabled).toBe(true);
    expect(c.getValue()).toBe("deluxe");
  });

  it("mirrors a date input type", () => {
    const c = buildControl({ tag: "input", inputType: "date" }, "2026-09-01");
    expect((c.element as HTMLInputElement).type).toBe("date");
    expect(c.getValue()).toBe("2026-09-01");
  });

  it("falls back to text for non-mirrored input types (e.g. password)", () => {
    const c = buildControl({ tag: "input", inputType: "password" }, "secret");
    expect((c.element as HTMLInputElement).type).toBe("text");
  });

  it("renders a numeric field as text (not type=number) so an unparseable value still shows, with a numeric hint", () => {
    const c = buildControl({ tag: "input", inputType: "number" }, "3.9");
    const input = c.element as HTMLInputElement;
    expect(input.type).toBe("text"); // NOT "number" — a number input blanks values it can't parse
    expect(input.inputMode).toBe("decimal");
    expect(c.getValue()).toBe("3.9");
  });

  it("renders a textarea", () => {
    const c = buildControl({ tag: "textarea" }, "long note");
    expect(c.element.tagName).toBe("TEXTAREA");
    expect(c.getValue()).toBe("long note");
  });

  it("defaults to a text input when there's no control (protocol source)", () => {
    const c = buildControl(undefined, "hi", { placeholder: "Enter value" });
    const input = c.element as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("text");
    expect(input.placeholder).toBe("Enter value");
  });

  it("applies disabled", () => {
    const c = buildControl({ tag: "input", inputType: "text" }, "x", { disabled: true });
    expect((c.element as HTMLInputElement).disabled).toBe(true);
  });

  it("renders a radio group with the selected option checked; getValue is the single value", () => {
    const c = buildControl(
      { tag: "radio", options: [{ value: "king", label: "King" }, { value: "queen", label: "Queen" }, { value: "twin", label: "Twin" }] },
      "queen",
    );
    const inputs = [...c.element.querySelectorAll<HTMLInputElement>("input")];
    expect(inputs.map((i) => i.type)).toEqual(["radio", "radio", "radio"]);
    expect(inputs.filter((i) => i.checked).map((i) => i.value)).toEqual(["queen"]);
    expect(c.getValue()).toBe("queen");
  });

  it("renders a checkbox group; getValue is newline-joined selected values", () => {
    const c = buildControl(
      { tag: "checkbox", options: [{ value: "ai", label: "AI" }, { value: "security", label: "Security" }, { value: "design", label: "Design" }] },
      "ai\ndesign",
    );
    const inputs = [...c.element.querySelectorAll<HTMLInputElement>("input")];
    expect(inputs.map((i) => i.type)).toEqual(["checkbox", "checkbox", "checkbox"]);
    expect(inputs.filter((i) => i.checked).map((i) => i.value)).toEqual(["ai", "design"]);
    expect(c.getValue()).toBe("ai\ndesign");
  });

  it("gives distinct radio groups distinct names so they don't share selection", () => {
    const a = buildControl({ tag: "radio", options: [{ value: "x", label: "X" }] }, "");
    const b = buildControl({ tag: "radio", options: [{ value: "y", label: "Y" }] }, "");
    const nameA = a.element.querySelector("input")!.name;
    const nameB = b.element.querySelector("input")!.name;
    expect(nameA).not.toBe(nameB);
  });

  it("an unselected radio group returns \"\"", () => {
    const c = buildControl({ tag: "radio", options: [{ value: "king", label: "King" }] }, "");
    expect(c.getValue()).toBe("");
  });

  it("disables every input in a disabled choice group", () => {
    const c = buildControl({ tag: "checkbox", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }, "a", { disabled: true });
    expect([...c.element.querySelectorAll<HTMLInputElement>("input")].every((i) => i.disabled)).toBe(true);
  });
});
