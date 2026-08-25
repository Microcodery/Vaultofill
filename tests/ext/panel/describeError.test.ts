import { describe, it, expect } from "vitest";
import { describeError } from "../../../src/ext/panel/describeError";

describe("describeError", () => {
  it("formats an Error as name: message", () => {
    expect(describeError(new TypeError("boom"))).toBe("TypeError: boom");
  });

  it("uses just the name when an Error has an empty message", () => {
    expect(describeError(new Error(""))).toBe("Error");
  });

  it("passes a thrown string through unchanged", () => {
    expect(describeError("plain failure")).toBe("plain failure");
  });

  it("serializes a plain object", () => {
    expect(describeError({ code: 5, reason: "nope" })).toBe('{"code":5,"reason":"nope"}');
  });

  it("renders undefined as \"undefined\" (the original bug) not \"undefined: undefined\"", () => {
    expect(describeError(undefined)).toBe("undefined");
  });

  it("renders null as \"null\"", () => {
    expect(describeError(null)).toBe("null");
  });

  it("extracts message and source location from an ErrorEvent-like object", () => {
    expect(describeError({ type: "error", message: "worker boom", filename: "w.js", lineno: 12 })).toBe(
      "worker boom (w.js:12)",
    );
  });

  it("unwraps a nested Error carried on .error", () => {
    expect(describeError({ type: "error", error: new RangeError("bad range") })).toBe("RangeError: bad range");
  });

  it("labels a bare worker error event, reading its non-enumerable type getter", () => {
    // Reproduce a real DOM Event: `type` is a non-enumerable getter, so
    // JSON.stringify drops it (yielding {"isTrusted":true}) but describeError
    // still reads it to prefix the label — the exact shape Firefox handed us.
    const evt: Record<string, unknown> = {};
    Object.defineProperty(evt, "isTrusted", { value: true, enumerable: true });
    Object.defineProperty(evt, "type", { get: () => "error", enumerable: false });
    expect(describeError(evt)).toBe('error event {"isTrusted":true}');
  });

  it("omits the line number when a message has a filename but no numeric lineno", () => {
    expect(describeError({ message: "boom", filename: "w.js" })).toBe("boom (w.js)");
  });

  it("prefixes a DOMException-like name when present", () => {
    expect(describeError({ name: "NotAllowedError", message: "denied" })).toBe("NotAllowedError: denied");
  });

  it("does not throw on a circular object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
    expect(describeError(circular)).toBe("[object Object]");
  });

  it("does not throw on a null-prototype object with no toString", () => {
    expect(() => describeError(Object.create(null))).not.toThrow();
  });

  it("does not throw when a getter on the value throws", () => {
    const hostile = {
      get message(): string {
        throw new Error("getter exploded");
      },
    };
    expect(() => describeError(hostile)).not.toThrow();
  });

  it("does not throw on a Proxy whose traps throw", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        getPrototypeOf() {
          throw new Error("proto trap");
        },
      },
    );
    expect(() => describeError(hostile)).not.toThrow();
  });
});
