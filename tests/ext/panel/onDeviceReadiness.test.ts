import { describe, it, expect } from "vitest";
import { raceReadiness } from "../../../src/ext/panel/onDeviceReadiness";

const never = new Promise<void>(() => {});
// A timer that fires immediately, so the timeout branch resolves without waiting.
const fireNow = (fn: () => void): void => fn();
// A timer that never fires, so only ready/failed can settle the race.
const neverFire = (): void => {};

describe("raceReadiness", () => {
  it("resolves true when ready wins", async () => {
    expect(await raceReadiness(Promise.resolve(), never, 1000, neverFire)).toBe(true);
  });

  it("resolves false when failure wins (before the timeout)", async () => {
    // The key regression: a failure must NOT wait out the timeout.
    expect(await raceReadiness(never, Promise.resolve(), 120_000, neverFire)).toBe(false);
  });

  it("resolves false on timeout when neither ready nor failed settles", async () => {
    expect(await raceReadiness(never, never, 120_000, fireNow)).toBe(false);
  });
});
