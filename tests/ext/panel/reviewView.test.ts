// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderProgressive, renderReview } from "../../../src/ext/panel/reviewView";
import { Detail, FilledEntry, FormField } from "../../../src/core/types";

const field = (label: string, humanReadable = label): FormField => ({ label, humanReadable, elementId: `el-${label}` });

const detail = (canonicalLabel: string, value: string): Detail => ({
  canonicalLabel,
  value,
  aliases: [],
  sensitivity: "private",
  volatility: "stable",
});

const green = (label: string, value: string): FilledEntry => ({
  field: field(label),
  value,
  confidence: "certain",
  detail: detail(label, value),
});

const yellow = (label: string, value: string): FilledEntry => ({
  field: field(label),
  value,
  confidence: "connected",
  detail: detail(label, value),
});

const red = (label: string): FilledEntry => ({ field: field(label), value: null, confidence: "missing" });

const container = (): HTMLElement => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
};

describe("renderReview", () => {
  it("renders one row per entry, sorted missing → connected → certain", () => {
    const el = container();
    renderReview(el, [green("EMAIL", "a@b.c"), red("FAVORITE_COLOR"), yellow("PHONE", "555")], () => {});
    const rows = [...el.querySelectorAll(".vof-row")];
    expect(rows.map((r) => r.className)).toEqual(["vof-row vof-missing", "vof-row vof-connected", "vof-row vof-certain"]);
    expect(el.querySelectorAll(".vof-actions button")).toHaveLength(2);
  });

  it("Fill invokes onAction with submit=false; Fill & Submit with submit=true", () => {
    const el = container();
    const onAction = vi.fn();
    renderReview(el, [green("EMAIL", "a@b.c")], onAction);
    (el.querySelector("#fill-only-button") as HTMLButtonElement).click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![2]).toBe(false);

    renderReview(el, [green("EMAIL", "a@b.c")], onAction); // fresh buttons (the first pair disabled themselves)
    (el.querySelector("#submit-button") as HTMLButtonElement).click();
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[1]![2]).toBe(true);
  });

  it("confirmedYellow holds exactly the checked connected rows; an unchecked one resolves to value null", () => {
    const el = container();
    const onAction = vi.fn();
    renderReview(el, [yellow("PHONE", "555"), yellow("CITY", "Springfield")], onAction);

    const yellowRows = [...el.querySelectorAll(".vof-row.vof-connected")];
    expect(yellowRows).toHaveLength(2);
    const phoneRow = yellowRows.find((r) => r.querySelector(".vof-field-label")!.textContent === "PHONE")!;
    const toggle = phoneRow.querySelector<HTMLInputElement>(".vof-menu input[type=checkbox]")!;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;

    (el.querySelector("#fill-only-button") as HTMLButtonElement).click();
    const [review] = onAction.mock.calls[0]!;
    expect(review.confirmedYellow.map((f: FormField) => f.label)).toEqual(["CITY"]);

    const byLabel = (label: string): FilledEntry => review.entries.find((e: FilledEntry) => e.field.label === label);
    expect(byLabel("PHONE").value).toBeNull(); // rejected guess: excluded from the fill
    expect(byLabel("CITY").value).toBe("Springfield");
  });

  it("passes edited values and the row tier through to the resolved entries", () => {
    const el = container();
    const onAction = vi.fn();
    renderReview(el, [green("EMAIL", "a@b.c")], onAction);
    const input = el.querySelector<HTMLInputElement>(".vof-row input.vof-value")!;
    input.value = "new@b.c";
    (el.querySelector("#fill-only-button") as HTMLButtonElement).click();
    const [review] = onAction.mock.calls[0]!;
    expect(review.entries[0].value).toBe("new@b.c");
    expect(review.entries[0].volatility).toBe("stable"); // the untouched badge's tier
  });
});

describe("renderProgressive", () => {
  it("paints pending rows for unresolved slots and read-only rows for resolved ones", () => {
    const el = container();
    const fields = [field("FAVORITE_COLOR"), field("EMAIL")];
    renderProgressive(el, fields, [undefined, green("EMAIL", "a@b.c")]);

    expect(el.querySelector(".vof-progress-note")!.textContent).toBe("Matched 1 field — labeling 1 more…");
    const pending = [...el.querySelectorAll(".vof-row.vof-pending")];
    expect(pending).toHaveLength(1);
    expect(pending[0]!.querySelector(".vof-field-label")!.textContent).toBe("FAVORITE_COLOR");

    const resolved = el.querySelector(".vof-row.vof-certain")!;
    const value = resolved.querySelector<HTMLInputElement>("input.vof-value")!;
    expect(value.value).toBe("a@b.c");
    expect(value.disabled).toBe(true); // preview: read-only until the final review
    expect(resolved.querySelector(".vof-menu-btn")).toBeNull();
  });

  it("shows the no-matches and all-matched notes", () => {
    const el = container();
    renderProgressive(el, [field("EMAIL")], [undefined]);
    expect(el.querySelector(".vof-progress-note")!.textContent).toBe("Labeling fields…");
    renderProgressive(el, [field("EMAIL")], [green("EMAIL", "a@b.c")]);
    expect(el.querySelector(".vof-progress-note")!.textContent).toBe("Finishing…");
  });
});
