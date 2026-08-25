import { describe, it, expect } from "vitest";
import { pickOpenProgress } from "../../../src/ext/panel/modelStatus";
import { ModelProgressMsg } from "../../../src/ext/offscreen/offscreenMessages";

const loading = (progress: number): ModelProgressMsg => ({ kind: "vof:modelProgress", status: "loading", text: "shaders", progress });
const errored: ModelProgressMsg = { kind: "vof:modelProgress", status: "error", text: "boom", progress: 0 };

describe("pickOpenProgress", () => {
  it("ready → a ready message that clears the status", () => {
    expect(pickOpenProgress({ ready: true, failed: false, lastProgress: loading(0.4) })).toEqual({
      kind: "vof:modelProgress",
      status: "ready",
      text: "",
      progress: 1,
    });
  });

  it("mid-load → the live loading progress", () => {
    expect(pickOpenProgress({ ready: false, failed: false, lastProgress: loading(0.3) })).toEqual(loading(0.3));
  });

  it("genuinely failed → the error message", () => {
    expect(pickOpenProgress({ ready: false, failed: true, lastProgress: errored })).toEqual(errored);
  });

  it("stale error during a retry (failed reset to false) → nothing, so we don't latch onto the endpoint", () => {
    // The retry hasn't broadcast its first "loading" yet; lastProgress still holds
    // the old error, but failed is already false. Must NOT render the error.
    expect(pickOpenProgress({ ready: false, failed: false, lastProgress: errored })).toBeUndefined();
  });

  it("just starting, no progress yet → nothing (keep the warming placeholder)", () => {
    expect(pickOpenProgress({ ready: false, failed: false })).toBeUndefined();
  });
});
