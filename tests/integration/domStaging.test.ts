// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { classify } from "../../src/core/fill/matcher";
import { DomFormSource } from "../../src/core/form/domFormSource";
import { ActiveContext } from "../../src/core/details/activeContext";
import { readFileSync } from "node:fs";
import { JsdomPageBridge, makeKeywordModel, parseHtml, seedVault } from "./harness";

/** Drive the full pipeline against a live jsdom document and assert the values
 *  land in the REAL input elements: getSchema (sweep) → classify → stage. */
describe("staging classified values back into the DOM", () => {
  it("fills the hotel-reservation inputs and highlights them by confidence", async () => {
    const doc = parseHtml(readFileSync("tests/fixtures/forms/hotel-reservation.html", "utf8"));
    const page = new JsdomPageBridge(doc);
    const source = new DomFormSource({ page: page as never });

    const schema = await source.getSchema();
    expect(schema.fields.length).toBeGreaterThanOrEqual(1);

    const entries = await classify(schema.fields, seedVault(true), new ActiveContext(), makeKeywordModel() as never);
    await source.stage(entries);

    // The full-name text input received the vault value and a green highlight.
    const fullName = doc.querySelector<HTMLInputElement>("input#full-name");
    expect(fullName).not.toBeNull();
    expect(fullName!.value).toBe("Ada Lovelace");
    expect(fullName!.getAttribute("data-vof-highlight")).toBe("green");

    // The email input was filled from the vault (green via alias) as well.
    const email = doc.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email!.value).toBe("ada@example.com");
    expect(email!.getAttribute("data-vof-highlight")).toBe("green");

    // A field with no vault value (special requests / dates) stays empty — nothing
    // is staged for a missing entry.
    const requests = doc.querySelector<HTMLTextAreaElement>("textarea");
    expect(requests!.value).toBe("");

    // commit clicks the discovered submit control.
    await source.commit();
    expect(page.clickedSubmit).toBeTruthy();
  });

  it("checks the right radio option when the model connects a value from context", async () => {
    const doc = parseHtml(readFileSync("tests/fixtures/forms/newsletter-signup.html", "utf8"));
    const page = new JsdomPageBridge(doc);
    const source = new DomFormSource({ page: page as never });
    const schema = await source.getSchema();

    // Seed a saved "How often?" preference so the radio group resolves and stages.
    const ctx = new ActiveContext();
    const vault = seedVault(true);
    // Stored as the option VALUE ("weekly") so stage's option match checks it directly
    // (the panel's label→value mapping is out of scope here).
    vault.set({ canonicalLabel: "FREQUENCY", value: "weekly", aliases: ["How often?"], sensitivity: "private", volatility: "stable" });

    const entries = await classify(schema.fields, vault, ctx, makeKeywordModel() as never);
    await source.stage(entries);

    // The email input was filled from the vault.
    const email = doc.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email!.value).toBe("ada@example.com");

    // The "Weekly" radio (matched by its option label) is the one checked.
    const weekly = doc.querySelector<HTMLInputElement>('input[type="radio"][value="weekly"]');
    expect(weekly!.checked).toBe(true);
    const daily = doc.querySelector<HTMLInputElement>('input[type="radio"][value="daily"]');
    expect(daily!.checked).toBe(false);
  });
});
