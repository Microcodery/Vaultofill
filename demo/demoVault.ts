import { Detail } from "../src/core/types";
import { Vault } from "../src/core/details/vault";
import { ActiveContext } from "../src/core/details/activeContext";
import { LabelRegistry } from "../src/core/labels/labelRegistry";

/** The three stores the pipeline threads together — the vault (permanent), the
 *  session context (volatile, reused across sites this session), and the label
 *  registry (the model's remembered vocabulary). They persist across form
 *  switches so cross-form linking shows up; "Reset demo data" rebuilds them. */
export interface DemoEnv {
  vault: Vault;
  ctx: ActiveContext;
  registry: LabelRegistry;
}

const D = (canonicalLabel: string, value: string, aliases: string[] = []): Detail => ({
  canonicalLabel,
  value,
  aliases,
  sensitivity: "private",
  volatility: "stable",
});

/**
 * Ada Lovelace's permanent details. A few labels carry alias phrasings that don't
 * fold onto the canonical name ("Email address", "Phone number", …) so those
 * fields resolve deterministically (green) rather than needing the model — the
 * rest go through the connected (yellow) path, so the demo shows both.
 */
export function seedDemoVault(): Vault {
  const v = new Vault();
  v.set(D("FULL_NAME", "Ada Lovelace", ["Full name", "Name", "Your name"]));
  v.set(D("FIRST_NAME", "Ada", ["First name", "Given name"]));
  v.set(D("LAST_NAME", "Lovelace", ["Last name", "Surname"]));
  v.set(D("EMAIL", "ada@analyticalengines.example", ["Email address", "Email", "Contact email"]));
  v.set(D("PHONE", "+1-555-0100", ["Phone number", "Phone", "Mobile"]));
  v.set(D("STREET_ADDRESS", "12 Analytical Way", ["Street address", "Address"]));
  v.set(D("CITY", "London", ["City"]));
  v.set(D("STATE", "CA", ["State", "State/Province", "State / Province"]));
  v.set(D("POSTAL_CODE", "94000", ["ZIP code", "Postal code", "ZIP"]));
  v.set(D("COUNTRY", "United Kingdom", ["Country"]));
  v.set(D("COMPANY", "Analytical Engines", ["Company", "Employer", "Company name"]));
  v.set(D("JOB_TITLE", "Mathematician", ["Job title", "Position", "Desired role"]));
  v.set(D("LINKEDIN", "https://linkedin.com/in/ada", ["LinkedIn", "LinkedIn URL"]));
  return v;
}

/** A fresh set of the three stores, seeded with Ada's vault. */
export function makeDemoEnv(): DemoEnv {
  return { vault: seedDemoVault(), ctx: new ActiveContext(), registry: new LabelRegistry() };
}
