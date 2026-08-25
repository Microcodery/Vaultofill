// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { classify } from "../../src/core/fill/matcher";
import { persistReview } from "../../src/core/fill/persistReview";
import { DomFormSource } from "../../src/core/form/domFormSource";
import { FilledEntry } from "../../src/core/types";
import { DemoBridge } from "../../demo/demoBridge";
import { makeKeywordModel } from "../../demo/keywordModel";
import { makeDemoEnv, seedDemoVault } from "../../demo/demoVault";

const docFor = (fixture: string): Document =>
  new DOMParser().parseFromString(readFileSync(`tests/fixtures/forms/${fixture}.html`, "utf8"), "text/html");
const entryFor = (entries: FilledEntry[], label: string): FilledEntry | undefined =>
  entries.find((e) => e.field.label === label);

/** Guards the demo wiring: the same DemoBridge + real pipeline the deployed page
 *  runs must fill a live document from the seeded vault, and its persistent env
 *  must link a value across forms. Mirrors domStaging.test.ts + crossForm.test.ts
 *  but through the demo modules. */
describe("demo flow wiring", () => {
  it("fills the hotel-reservation form from the seeded vault, greenifying known fields", async () => {
    const doc = docFor("hotel-reservation");
    const source = new DomFormSource({ page: new DemoBridge(doc) });
    const env = makeDemoEnv();

    const entries = await classify((await source.getSchema()).fields, env.vault, env.ctx, makeKeywordModel(), undefined, env.registry);
    expect(entryFor(entries, "EMAIL")?.confidence).toBe("certain"); // seeded alias → green, not just filled
    await source.stage(entries);

    const email = doc.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email!.value).toBe("ada@analyticalengines.example");
    expect(email!.style.outline).toContain("2px solid"); // green highlight painted
    expect(email!.style.boxShadow).not.toBe("");
    expect(doc.querySelector<HTMLInputElement>("input#full-name")?.value).toBe("Ada Lovelace");
  });

  it("links a value across two forms through the persistent demo env (the headline)", async () => {
    const env = makeDemoEnv();
    const model = makeKeywordModel();

    // Fill a trip date on the cruise form ("Embarkation date" → START_DATE, a seed
    // volatile label → saved to session context on Fill, no tier bump needed).
    const cruise = new DomFormSource({ page: new DemoBridge(docFor("cruise-booking")) });
    const first = await classify((await cruise.getSchema()).fields, env.vault, env.ctx, model, undefined, env.registry);
    const embark = entryFor(first, "START_DATE")!;
    persistReview({ entries: [{ ...embark, value: "2027-06-01" }], confirmedYellow: [] }, env.vault, env.ctx, env.registry);

    // A different form phrases it "Arrival date" and reuses the value from the env.
    const campground = new DomFormSource({ page: new DemoBridge(docFor("campground-reservation")) });
    const second = await classify((await campground.getSchema()).fields, env.vault, env.ctx, model, undefined, env.registry);
    const arrival = entryFor(second, "START_DATE");
    expect(arrival).toBeDefined();
    expect(arrival!.value).toBe("2027-06-01");
    expect(["connected", "certain"]).toContain(arrival!.confidence);
  });
});

// Keep seedDemoVault exercised (used by makeDemoEnv) so an unused-export refactor is caught.
void seedDemoVault;
