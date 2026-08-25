import { describe, it, expect } from "vitest";
import { volatilityFor, sensitivityFor, CANONICAL_LABEL_NAMES } from "../../../src/core/labels/canonicalLabels";

describe("volatilityFor", () => {
  it("treats identity/contact/id labels as stable (Vault, permanent)", () => {
    for (const name of ["FIRST_NAME", "EMAIL", "STREET_ADDRESS", "CARD_NUMBER", "PASSPORT_NUMBER"]) {
      expect(volatilityFor(name)).toBe("stable");
    }
  });

  it("treats trip-level booking details as volatile (session, cross-site)", () => {
    for (const name of ["START_DATE", "END_DATE", "NUM_PEOPLE", "TIME"]) {
      expect(volatilityFor(name)).toBe("volatile");
    }
  });

  it("treats site-specific fields as ephemeral (not persisted)", () => {
    for (const name of ["ROOM_TYPE", "SPECIAL_REQUESTS", "COVER_LETTER"]) {
      expect(volatilityFor(name)).toBe("ephemeral");
    }
  });

  it("defaults an invented label (not in the seed map) to stable so it persists and can be reused", () => {
    expect(volatilityFor("CUMULATIVE_GPA")).toBe("stable");
    expect(volatilityFor("VEHICLE_MAKE")).toBe("stable");
  });

  it("assigns a volatility to every canonical label", () => {
    for (const name of CANONICAL_LABEL_NAMES) {
      expect(["stable", "volatile", "ephemeral"]).toContain(volatilityFor(name));
    }
  });
});

describe("sensitivityFor", () => {
  it("defaults financial/id labels to sensitive", () => {
    expect(sensitivityFor("CARD_NUMBER")).toBe("sensitive");
    expect(sensitivityFor("PASSPORT_NUMBER")).toBe("sensitive");
  });

  it("defaults an invented sensitive-looking label to sensitive (by keyword)", () => {
    for (const name of ["SSN", "BANK_ACCOUNT_NUMBER", "CVV_CODE", "CREDIT_CARD", "TAX_ID"]) {
      expect(sensitivityFor(name)).toBe("sensitive");
    }
  });

  it("defaults everything else (and unknowns) to private", () => {
    for (const name of ["FIRST_NAME", "EMAIL", "START_DATE", "ROOM_TYPE", "CUMULATIVE_GPA", "UNKNOWN", ""]) {
      expect(sensitivityFor(name)).toBe("private");
    }
  });

  it("boundary-matches ambiguous tokens so innocent labels aren't over-gated", () => {
    // Ambiguous tokens ("SHIPPING"⊃PIN, "SCORECARD"⊃CARD) match only on boundaries.
    expect(sensitivityFor("SHIPPING")).toBe("private");
    expect(sensitivityFor("SCORECARD")).toBe("private");
    // …but a real boundary token still trips.
    expect(sensitivityFor("PIN_CODE")).toBe("sensitive");
    expect(sensitivityFor("CREDIT_CARD")).toBe("sensitive");
    expect(sensitivityFor("SOCIAL_SECURITY_NUMBER")).toBe("sensitive");
  });

  it("substring-matches DISTINCTIVE credential tokens so even an unsegmented model label gates (fail-safe)", () => {
    // A gate must fail safe: a run-together label the model emits without separators
    // must still be caught for the high-risk distinctive tokens.
    expect(sensitivityFor("SSNVALUE")).toBe("sensitive");
    expect(sensitivityFor("CVVCODE")).toBe("sensitive");
    expect(sensitivityFor("PASSPORTID")).toBe("sensitive");
  });
});
