// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { classify } from "../../src/core/fill/matcher";
import { FilledEntry } from "../../src/core/types";
import {
  CLUSTERS,
  classifyForm,
  entryFor,
  fillAndSave,
  fillNatural,
  loadFixture,
  makeKeywordModel,
  newEnv,
} from "./harness";

/** A field "linked" from a prior form is either a deterministic fold (certain) or
 *  an LLM label match to the saved value (connected). */
const linked = (e: FilledEntry | undefined): boolean => e != null && (e.confidence === "connected" || e.confidence === "certain");

describe("cross-form field linking", () => {
  // The core capability: a value saved once resolves on OTHER forms that ask about
  // the same concept with different wording.
  it.each(CLUSTERS)("links $label saved on one form to the differently-phrased fields on the others", async (cluster) => {
    const env = newEnv();
    const [first, ...rest] = cluster.forms;
    await fillAndSave(first!, cluster.label, cluster.value, env);

    for (const form of rest) {
      const entry = (await classifyForm(form, env)).find((e) => e.field.label === cluster.label);
      expect(entry, `${form} should resolve a field to ${cluster.label}`).toBeDefined();
      expect(linked(entry), `${form}: ${cluster.label} should reuse the saved value`).toBe(true);
      expect(entry!.value).toBe(cluster.value);
    }
  });

  it("links 'company goals' across four grant applications that each ask differently", async () => {
    const env = newEnv();
    const answer = "Double our headcount and open a European office.";
    // Fill it once on the small-business grant ("What are your company's goals?").
    await fillAndSave("small-business-grant", "COMPANY_GOALS", answer, env);

    // The other three phrase it differently ("...organization's objectives",
    // "...mission and goals", "...aim to achieve") and still reuse the answer via
    // the LLM label match — a connected (yellow) resolve, not a literal text fold.
    for (const form of ["innovation-grant", "nonprofit-mission-grant", "startup-accelerator"]) {
      const goals = await entryFor(form, "COMPANY_GOALS", env);
      expect(goals.confidence).toBe("connected");
      expect(goals.value).toBe(answer);
    }
  });

  it("teaches a confirmed phrasing as an alias so a later form resolves it without the model", async () => {
    const env = newEnv();
    // Save an emergency contact from a form phrased "Emergency contact name".
    await fillAndSave("campground-reservation", "EMERGENCY_CONTACT", "Jordan Rivera", env);

    // A second form with the same phrasing is a connected (yellow) match; confirming
    // it (persist with the field in confirmedYellow) learns the phrasing as an alias.
    expect((await entryFor("dental-new-patient", "EMERGENCY_CONTACT", env)).confidence).toBe("connected");
    await fillAndSave("dental-new-patient", "EMERGENCY_CONTACT", "Jordan Rivera", env, { confirm: true });

    // A third form with that phrasing now resolves DETERMINISTICALLY — the question
    // never reaches the model.
    const model = makeKeywordModel();
    const entries = await classify(loadFixture("gym-membership").fields, env.vault, env.ctx, model as never, undefined, env.registry);
    const third = entries.find((e) => e.field.label === "EMERGENCY_CONTACT")!;
    expect(third.confidence).toBe("certain");
    expect(third.value).toBe("Jordan Rivera");
    const asked = model.complete.mock.calls.flatMap((c) => c[0].messages.map((m: { content: string }) => m.content)).join("\n");
    expect(asked).not.toContain("Emergency contact name");
  });

  // Honesty checks: the linking above depends on the value actually being SAVED.
  // These pin the real default tiers so nobody mistakes "links" for "links out of
  // the box" — a novel field is One-time by default; a date lives in session context.
  it("a novel field left at its default tier is One-time — it doesn't persist or link", async () => {
    const env = newEnv();
    const goals = await entryFor("small-business-grant", "COMPANY_GOALS", env);
    expect(goals.volatility).toBe("ephemeral"); // novel labels default to One-time
    await fillNatural("small-business-grant", "COMPANY_GOALS", "Grow revenue 3x.", env);
    expect(env.vault.getByCanonical("COMPANY_GOALS")).toBeUndefined(); // not saved

    // So a differently-phrased grant field does NOT reuse it — it stays red/missing.
    const b = await entryFor("innovation-grant", "COMPANY_GOALS", env);
    expect(b.confidence).toBe("missing");
    expect(b.value).toBeNull();
  });

  it("a volatile field (trip date) links across forms via the SESSION context, not the vault", async () => {
    const env = newEnv();
    // START_DATE is a seed VOLATILE label — reused across sites within a session via
    // ActiveContext, not the permanent vault.
    await fillNatural("cruise-booking", "START_DATE", "2027-06-01", env); // "Embarkation date"
    expect(env.vault.getByCanonical("START_DATE")).toBeUndefined();
    expect(env.ctx.get("START_DATE")?.value).toBe("2027-06-01");

    // A different form's differently-phrased date reuses it from context.
    const b = await entryFor("campground-reservation", "START_DATE", env); // "Arrival date"
    expect(["connected", "certain"]).toContain(b.confidence);
    expect(b.value).toBe("2027-06-01");
  });

  it("a vault seeded with every cluster value fills the matching field on all the forms", async () => {
    const env = newEnv();
    for (const c of CLUSTERS) {
      env.vault.set({ canonicalLabel: c.label, value: c.value, aliases: [], sensitivity: "private", volatility: "stable" });
    }
    const forms = [...new Set(CLUSTERS.flatMap((c) => c.forms))];
    for (const form of forms) {
      const entries = await classifyForm(form, env);
      for (const c of CLUSTERS.filter((x) => x.forms.includes(form))) {
        const entry = entries.find((e) => e.field.label === c.label);
        expect(entry, `${form} should resolve ${c.label}`).toBeDefined();
        expect(linked(entry)).toBe(true);
        expect(entry!.value).toBe(c.value);
      }
    }
  });
});
