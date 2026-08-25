// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fillForm, newEnv } from "./harness";

const valueFor = (label: string): string => `val:${label}`;

describe("e2e: the vault grows across a sequence of forms", () => {
  it("adds each form's new fields and reuses ones it already knows, without duplicating", async () => {
    const env = newEnv();
    // A realistic session across unrelated form types with deliberate overlaps.
    const sequence = [
      "small-business-grant",
      "startup-accelerator",
      "cruise-booking",
      "internship-application",
      "dental-new-patient",
      "tech-conference-registration",
      "campground-reservation",
    ];

    const seen = new Set<string>();
    for (const form of sequence) {
      const before = env.vault.keys().length;
      const touched = await fillForm(form, env, valueFor);
      const added = [...touched].filter((l) => !seen.has(l));
      touched.forEach((l) => seen.add(l));

      // The vault grew by EXACTLY the newly-seen labels; fields it already knew
      // didn't grow it (they upsert, not append).
      expect(env.vault.keys().length, `after ${form}`).toBe(before + added.length);
      // Everything this form touched is stored with its value and a single variant.
      for (const label of touched) {
        expect(env.vault.getByCanonical(label)?.value).toBe(valueFor(label));
        expect(env.vault.getVariants(label)).toHaveLength(1);
      }
    }

    // Final vault == the union of every recognized label across the whole run.
    expect(new Set(env.vault.keys())).toEqual(seen);
    expect(env.vault.keys().length).toBeGreaterThanOrEqual(12); // sanity: it really grew
  });

  it("re-processing the same form neither grows nor duplicates the vault", async () => {
    const env = newEnv();
    const first = await fillForm("cruise-booking", env, valueFor);
    const size = env.vault.keys().length;
    expect(size).toBe(first.size);

    await fillForm("cruise-booking", env, valueFor); // same form again
    expect(env.vault.keys().length).toBe(size); // no growth
    for (const label of first) expect(env.vault.getVariants(label)).toHaveLength(1); // no duplicate variant
  });

  it("keeps growing monotonically across all 20 new fixtures without error", async () => {
    const env = newEnv();
    const forms = [
      "small-business-grant", "innovation-grant", "nonprofit-mission-grant", "startup-accelerator",
      "business-line-of-credit", "supplier-onboarding", "saas-trial-signup", "cruise-booking",
      "campground-reservation", "guided-tour-booking", "rental-car-pickup", "spa-day-booking",
      "tech-conference-registration", "workshop-signup", "catering-order", "marathon-registration",
      "dental-new-patient", "clinical-trial-screening", "gym-membership", "internship-application",
    ];
    let size = 0;
    for (const form of forms) {
      await fillForm(form, env, valueFor);
      expect(env.vault.keys().length, `after ${form}`).toBeGreaterThanOrEqual(size); // never shrinks
      size = env.vault.keys().length;
    }
    // Every stored value is intact and each label has exactly one variant.
    for (const label of env.vault.keys()) {
      expect(env.vault.getByCanonical(label)!.value).toBe(valueFor(label));
      expect(env.vault.getVariants(label)).toHaveLength(1);
    }
  });
});
