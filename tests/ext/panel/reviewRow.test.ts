// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildEntryRow, buildPendingRow, persistableLabel } from "../../../src/ext/panel/reviewRow";
import { Detail, FilledEntry, FormField } from "../../../src/core/types";
import { UNKNOWN } from "../../../src/core/labels/labelQuestions";

const field = (over: Partial<FormField> = {}): FormField => ({
  label: "EMAIL",
  humanReadable: "Email address",
  elementId: "e1",
  ...over,
});

const detail = (over: Partial<Detail> = {}): Detail => ({
  canonicalLabel: "EMAIL",
  value: "me@home.com",
  aliases: [],
  sensitivity: "private",
  volatility: "stable",
  ...over,
});

const entry = (over: Partial<FilledEntry> = {}): FilledEntry => ({
  field: field(),
  value: "me@home.com",
  confidence: "certain",
  ...over,
});

const selectField = (label = "ROOM_TYPE"): FormField =>
  field({
    label,
    humanReadable: "Room type",
    control: { tag: "select", options: [{ value: "k", label: "King" }, { value: "q", label: "Queen" }] },
  });

describe("persistableLabel", () => {
  it("returns undefined for UNKNOWN", () => {
    expect(persistableLabel(entry({ field: field({ label: UNKNOWN }), detail: undefined }))).toBeUndefined();
  });

  it("returns undefined for an empty label", () => {
    expect(persistableLabel(entry({ field: field({ label: "" }), detail: undefined }))).toBeUndefined();
  });

  it("prefers the matched detail's canonical label over the field label", () => {
    expect(persistableLabel(entry({ field: field({ label: "E_MAIL_ADDR" }), detail: detail() }))).toBe("EMAIL");
  });

  it("uses the field label for a detail-less option control", () => {
    expect(persistableLabel(entry({ field: selectField(), detail: undefined }))).toBe("ROOM_TYPE");
  });
});

describe("buildEntryRow — tier badge", () => {
  it("renders the badge only when the entry has a persistable label", () => {
    const withLabel = buildEntryRow(entry()).rowEl;
    expect(withLabel.querySelector(".vof-tier-badge")).not.toBeNull();

    const unknown = buildEntryRow(entry({ field: field({ label: UNKNOWN }), detail: undefined, value: null, confidence: "missing" })).rowEl;
    expect(unknown.querySelector(".vof-tier-badge")).toBeNull();
  });

  it("seeds the badge from entry.volatility over the detail's tier", () => {
    const { rowEl, row } = buildEntryRow(entry({ detail: detail({ volatility: "stable" }), volatility: "ephemeral" }));
    expect(rowEl.querySelector(".vof-tier-badge")!.textContent).toBe("One-time");
    expect(row.getVolatility!()).toBe("ephemeral");
  });
});

describe("buildEntryRow — variant combobox", () => {
  const variants = [detail({ variant: "personal" }), detail({ variant: "work", value: "me@work.com" })];

  it("renders a datalist combobox when there are 2+ variants", () => {
    const { rowEl, row } = buildEntryRow(entry({ variants, variant: "personal" }));
    expect(rowEl.querySelector("datalist")).not.toBeNull();
    expect(row.getVariant!()).toBe("personal");
  });

  it("renders a plain control for a single variant", () => {
    const { rowEl } = buildEntryRow(entry({ variants: [detail({ variant: "personal" })] }));
    expect(rowEl.querySelector("datalist")).toBeNull();
    expect((rowEl.querySelector("input.vof-value") as HTMLInputElement).value).toBe("me@home.com");
  });

  it("never uses the combobox for an option control, even with 2+ variants", () => {
    const { rowEl } = buildEntryRow(entry({ field: selectField(), value: "King", variants }));
    expect(rowEl.querySelector("datalist")).toBeNull();
    expect(rowEl.querySelector("select")).not.toBeNull();
  });
});

describe("buildEntryRow — sensitive gating", () => {
  it("gates a sensitive-labeled entry (no detail) behind an unchecked lock", () => {
    const { rowEl, row } = buildEntryRow(
      entry({ field: field({ label: "SSN", humanReadable: "Social security number" }), detail: undefined, value: "123-45-6789" }),
    );
    const lock = rowEl.querySelector<HTMLButtonElement>(".vof-sensitive")!;
    expect(lock.textContent).toBe("🔒");
    expect(row.includeCheckbox!.checked).toBe(false);

    lock.click();
    expect(row.includeCheckbox!.checked).toBe(true);
    expect(lock.textContent).toBe("🔓");
  });

  it("gives a connected (yellow) entry a checked include-toggle in the menu, not a lock", () => {
    const { rowEl, row } = buildEntryRow(entry({ confidence: "connected", detail: detail() }));
    expect(rowEl.querySelector(".vof-sensitive")).toBeNull();
    expect(row.includeCheckbox!.checked).toBe(true);
    expect(rowEl.querySelector(".vof-menu")!.contains(row.includeCheckbox!)).toBe(true);
  });
});

describe("buildEntryRow — preview mode", () => {
  it("renders a read-only value with no badge, menu, or row accessors", () => {
    const { rowEl, row } = buildEntryRow(entry({ detail: detail() }), { preview: true });
    expect(rowEl.querySelector(".vof-tier-badge")).toBeNull();
    expect(rowEl.querySelector(".vof-menu-btn")).toBeNull();
    const input = rowEl.querySelector<HTMLInputElement>("input.vof-value")!;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe("me@home.com");
    expect(row.getVolatility).toBeUndefined();
    expect(row.getNewLabel).toBeUndefined();
  });
});

describe("buildEntryRow — label chip", () => {
  it("shows the matched detail's label on a green row", () => {
    const chip = buildEntryRow(entry({ detail: detail() })).rowEl.querySelector(".vof-used-label")!;
    expect(chip.textContent).toBe("Email");
    expect(chip.getAttribute("title")).toContain("Filled from your saved");
  });

  it("shows the label a red row will save under, with an empty placeholder control", () => {
    const { rowEl } = buildEntryRow(
      entry({ field: field({ label: "FAVORITE_COLOR", humanReadable: "Favorite color?" }), detail: undefined, value: null, confidence: "missing" }),
    );
    const chip = rowEl.querySelector(".vof-used-label")!;
    expect(chip.textContent).toBe("Favorite color");
    expect(chip.getAttribute("title")).toContain("New field");
    const input = rowEl.querySelector<HTMLInputElement>("input.vof-value")!;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Enter value");
  });

  it("shows no chip on an unlabeled (UNKNOWN) red row", () => {
    const { rowEl } = buildEntryRow(entry({ field: field({ label: UNKNOWN }), detail: undefined, value: null, confidence: "missing" }));
    expect(rowEl.querySelector(".vof-used-label")).toBeNull();
  });
});

describe("buildPendingRow", () => {
  it("renders the field label, a labeling… mark, and a disabled value control", () => {
    const rowEl = buildPendingRow(field({ humanReadable: "Email address" }));
    expect(rowEl.className).toBe("vof-row vof-pending");
    expect(rowEl.querySelector(".vof-field-label")!.textContent).toBe("Email address");
    expect(rowEl.querySelector(".vof-pending-mark")!.textContent).toBe("labeling…");
    expect(rowEl.querySelector<HTMLInputElement>("input.vof-value")!.disabled).toBe(true);
  });

  it("falls back to '(no label)' when the field has none", () => {
    const rowEl = buildPendingRow({ label: "", humanReadable: "" });
    expect(rowEl.querySelector(".vof-field-label")!.textContent).toBe("(no label)");
  });
});
