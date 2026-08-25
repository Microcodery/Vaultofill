import { describe, it, expect, vi } from "vitest";
import { Vault } from "../../../src/core/details/vault";
import { ActiveContext } from "../../../src/core/details/activeContext";
import { classify, deterministicMatch } from "../../../src/core/fill/matcher";
import { LabelRegistry } from "../../../src/core/labels/labelRegistry";
import { Detail, FormField, Volatility } from "../../../src/core/types";

const D = (canonicalLabel: string, value: string, aliases: string[] = [], volatility: Volatility = "stable"): Detail => ({
  canonicalLabel,
  value,
  aliases,
  sensitivity: "private" as const,
  volatility,
});

describe("classify with a LabelRegistry", () => {
  it("surfaces registry-remembered invented labels in the LLM vocab so they're reused", async () => {
    const registry = new LabelRegistry();
    registry.learn("FAVORITE_COLOR", "favorite color"); // remembered from a prior site
    const fields: FormField[] = [{ label: "", humanReadable: "Which colour do you prefer?", elementId: "e0" }];
    const model = { complete: vi.fn(async (_req: { system: string }) => ({ "Which colour do you prefer?": "FAVORITE_COLOR" })) };
    const entries = await classify(fields, new Vault(), new ActiveContext(), model as never, undefined, registry);
    // The prompt's known-label list includes the remembered invention.
    const system = model.complete.mock.calls[0]![0].system;
    expect(system).toContain("FAVORITE_COLOR");
    expect(entries[0]).toMatchObject({ confidence: "missing", field: { label: "FAVORITE_COLOR" } });
  });
});

describe("deterministicMatch", () => {
  it("matches a swept field's question against a learned alias", () => {
    const v = new Vault();
    v.set(D("EMAIL", "a@b.com", ["Your email"]));
    const field: FormField = { label: "", humanReadable: "your email", elementId: "e1" };
    expect(deterministicMatch(field, v)?.canonicalLabel).toBe("EMAIL");
  });

  it("matches a protocol field against its canonical label", () => {
    const v = new Vault();
    v.set(D("FIRST_NAME", "Ada"));
    expect(deterministicMatch({ label: "FIRST_NAME", humanReadable: "" }, v)?.value).toBe("Ada");
  });
});

describe("classify", () => {
  it("resolves certain (deterministic) / connected (labeled) / missing (unknown)", async () => {
    const v = new Vault();
    v.set(D("FIRST_NAME", "Ada", ["First name"]));
    v.set(D("EMAIL", "a@b.com"));
    const fields: FormField[] = [
      { label: "", humanReadable: "First name", elementId: "e0" }, // certain: alias hit
      { label: "", humanReadable: "Your email address", elementId: "e1" }, // connected: labeled → EMAIL (in vault)
      { label: "", humanReadable: "Passport number", elementId: "e2" }, // missing: UNKNOWN
    ];
    // Only the two unmatched questions reach the LLM, in order.
    const model = { complete: vi.fn(async () => ({ "Your email address": "EMAIL", "Passport number": "UNKNOWN" })) };

    const entries = await classify(fields, v, new ActiveContext(), model as never);

    expect(entries[0]).toMatchObject({ confidence: "certain", value: "Ada" });
    expect(entries[1]).toMatchObject({ confidence: "connected", value: "a@b.com" });
    expect(entries[2]).toMatchObject({ confidence: "missing", value: null });
    // A red/UNKNOWN field still gets a label (derived from the question) so the
    // user can fill it. The derived PASSPORT_NUMBER is a known seed, so it keeps
    // its curated tier (no ephemeral override).
    expect(entries[2]!.field.label).toBe("PASSPORT_NUMBER");
    expect(entries[2]!.volatility).toBeUndefined();
    expect(model.complete).toHaveBeenCalledTimes(1); // ONE labeling call for all unknowns
  });

  it("defaults a NOVEL (non-seed) red label to One-time so it isn't remembered unless the user opts in", async () => {
    const fields: FormField[] = [
      { label: "", humanReadable: "What is your favorite color?", elementId: "e0" }, // model invents a novel label
      { label: "", humanReadable: "Referral code", elementId: "e1" }, // UNKNOWN → question-derived novel label
    ];
    const model = { complete: vi.fn(async () => ({ "What is your favorite color?": "FAVORITE_COLOR", "Referral code": "UNKNOWN" })) };
    const entries = await classify(fields, new Vault(), new ActiveContext(), model as never);
    expect(entries[0]).toMatchObject({ confidence: "missing", value: null });
    expect(entries[0]!.field.label).toBe("FAVORITE_COLOR"); // model's label kept
    expect(entries[0]!.volatility).toBe("ephemeral"); // novel → One-time
    expect(entries[0]!.derivedLabel).toBeUndefined(); // model-invented → learnable
    expect(entries[1]!.field.label).toBe("REFERRAL_CODE"); // derived from the question
    expect(entries[1]!.volatility).toBe("ephemeral"); // novel → One-time
    expect(entries[1]!.derivedLabel).toBe(true); // question-derived → not learnable
  });

  it("emits deterministic matches via onDeterministic before the LLM call, with pending slots undefined", async () => {
    const v = new Vault();
    v.set(D("FIRST_NAME", "Ada", ["First name"]));
    const fields: FormField[] = [
      { label: "", humanReadable: "First name", elementId: "e0" }, // deterministic
      { label: "", humanReadable: "Mystery field", elementId: "e1" }, // pending → LLM
    ];
    let partialAtCallback: (import("../../../src/core/types").FilledEntry | undefined)[] | undefined;
    const model = {
      complete: vi.fn(async () => {
        // The callback must have already fired (before labeling) with the green match.
        expect(partialAtCallback?.[0]).toMatchObject({ confidence: "certain", value: "Ada" });
        expect(partialAtCallback?.[1]).toBeUndefined();
        return { "Mystery field": "UNKNOWN" };
      }),
    };

    await classify(fields, v, new ActiveContext(), model as never, (partial) => {
      partialAtCallback = partial;
    });

    expect(partialAtCallback).toBeDefined();
  });

  it("labels a connected field with its canonical when the swept label was empty", async () => {
    const v = new Vault();
    v.set(D("EMAIL", "a@b.com"));
    const fields: FormField[] = [{ label: "", humanReadable: "Contact e-mail", elementId: "e1" }];
    const model = { complete: vi.fn(async () => ["EMAIL"]) };

    const entries = await classify(fields, v, new ActiveContext(), model as never);
    expect(entries[0]!.field.label).toBe("EMAIL");
    expect(entries[0]!.confidence).toBe("connected");
  });

  it("marks a labeled field missing when the vault has no value for that canonical", async () => {
    const v = new Vault(); // empty vault
    const fields: FormField[] = [{ label: "", humanReadable: "Phone number", elementId: "e1" }];
    const model = { complete: vi.fn(async () => ["PHONE"]) };

    const entries = await classify(fields, v, new ActiveContext(), model as never);
    expect(entries[0]).toMatchObject({ confidence: "missing", value: null });
    expect(entries[0]!.field.label).toBe("PHONE"); // canonical still recorded
  });

  it("reuses a volatile value from the session context when the vault lacks it", async () => {
    const v = new Vault(); // no booking date in the permanent vault
    const ctx = new ActiveContext();
    ctx.set("START_DATE", D("START_DATE", "2026-09-01", [], "volatile"));
    const fields: FormField[] = [{ label: "", humanReadable: "Check-in date", elementId: "e1" }];
    const model = { complete: vi.fn(async () => ["START_DATE"]) };

    const entries = await classify(fields, v, ctx, model as never);
    expect(entries[0]).toMatchObject({ confidence: "connected", value: "2026-09-01" });
  });

  it("attaches the label's variants and the resolved variant to a matched entry", async () => {
    const v = new Vault();
    v.set({ canonicalLabel: "EMAIL", variant: "personal", value: "me@home.com", aliases: ["Your email"], sensitivity: "private", volatility: "stable" });
    v.set({ canonicalLabel: "EMAIL", variant: "work", value: "me@work.com", aliases: [], sensitivity: "private", volatility: "stable" });
    const entries = await classify([{ label: "", humanReadable: "Your email", elementId: "e1" }], v, new ActiveContext(), { complete: vi.fn() } as never);
    expect(entries[0]).toMatchObject({ confidence: "certain", value: "me@home.com", variant: "personal" });
    expect(entries[0]!.variants?.map((d) => d.variant)).toEqual(["personal", "work"]);
  });

  it("does not overwrite a protocol field's non-empty label", async () => {
    const v = new Vault();
    v.set(D("EMAIL", "a@b.com"));
    const fields: FormField[] = [{ label: "email_addr", humanReadable: "Email Address" }];
    const model = { complete: vi.fn(async () => ({ "Email Address": "EMAIL" })) };

    const entries = await classify(fields, v, new ActiveContext(), model as never);
    expect(entries[0]!.field.label).toBe("email_addr"); // preserved for the POST
    expect(entries[0]!.confidence).toBe("connected");
  });

  it("labels two fields that share the same question consistently (deduped, one label)", async () => {
    const v = new Vault();
    v.set(D("EMAIL", "a@b.com"));
    const fields: FormField[] = [
      { label: "", humanReadable: "Contact e-mail", elementId: "e1" },
      { label: "", humanReadable: "Contact e-mail", elementId: "e2" },
    ];
    // Deduped to ONE question → the array reply has a single entry; both fields
    // must still resolve to EMAIL (not one collapsing to UNKNOWN).
    const model = { complete: vi.fn(async () => ["EMAIL"]) };

    const entries = await classify(fields, v, new ActiveContext(), model as never);
    expect(entries[0]).toMatchObject({ confidence: "connected", value: "a@b.com" });
    expect(entries[1]).toMatchObject({ confidence: "connected", value: "a@b.com" });
  });

  it("sets a certain DOM field's label to its canonical", async () => {
    const v = new Vault();
    v.set(D("FIRST_NAME", "Ada", ["First name"]));
    const entries = await classify(
      [{ label: "", humanReadable: "First name", elementId: "e1" }],
      v,
      new ActiveContext(),
      { complete: vi.fn() } as never,
    );
    expect(entries[0]!.field.label).toBe("FIRST_NAME");
  });

  it("does not call the model when every field matches deterministically", async () => {
    const v = new Vault();
    v.set(D("FIRST_NAME", "Ada", ["First name"]));
    const model = { complete: vi.fn() };
    const entries = await classify([{ label: "", humanReadable: "First name" }], v, new ActiveContext(), model as never);
    expect(entries[0]).toMatchObject({ confidence: "certain", value: "Ada" });
    expect(model.complete).not.toHaveBeenCalled();
  });
});
