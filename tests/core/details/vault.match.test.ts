import { describe, it, expect } from "vitest";
import { Vault } from "../../../src/core/details/vault";
const D = (canonicalLabel: string, value: string, aliases: string[] = []) =>
  ({ canonicalLabel, value, aliases, sensitivity: "private" as const, volatility: "stable" as const });

describe("Vault.findByLabel", () => {
  it("matches canonical label case/format-insensitively", () => {
    const v = new Vault(); v.set(D("FIRST_NAME", "Ada"));
    expect(v.findByLabel("first name")?.value).toBe("Ada");
    expect(v.findByLabel("First-Name")?.value).toBe("Ada");
  });
  it("matches via alias", () => {
    const v = new Vault(); v.set(D("FIRST_NAME", "Ada", ["forename"]));
    expect(v.findByLabel("Forename")?.value).toBe("Ada");
  });
  it("returns undefined for unknown label", () => {
    const v = new Vault(); v.set(D("FIRST_NAME", "Ada"));
    expect(v.findByLabel("passport_number")).toBeUndefined();
  });
  it("addAlias makes a previously-unknown label resolve", () => {
    const v = new Vault(); v.set(D("FIRST_NAME", "Ada"));
    v.addAlias("FIRST_NAME", "given name");
    expect(v.findByLabel("GIVEN NAME")?.value).toBe("Ada");
  });
});
