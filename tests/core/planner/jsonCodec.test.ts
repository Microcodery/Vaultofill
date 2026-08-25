import { describe, it, expect } from "vitest";
import { decodeJson, JsonParseError } from "../../../src/core/planner/jsonCodec";
describe("decodeJson", () => {
  it("parses clean JSON to a typed object", () =>
    expect(decodeJson<{ fields: unknown[] }>('{"fields":[]}')).toEqual({ fields: [] }));
  it("strips fences", () =>
    expect(decodeJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }));
  it("extracts object amid prose", () =>
    expect(decodeJson('sure: {"a":1} done')).toEqual({ a: 1 }));
  it("throws on garbage", () =>
    expect(() => decodeJson("no json")).toThrow(JsonParseError));
  it("parses a top-level array", () =>
    expect(decodeJson<string[]>('["A","B"]')).toEqual(["A", "B"]));
  it("parses a fenced array", () =>
    expect(decodeJson<string[]>('```json\n["A"]\n```')).toEqual(["A"]));
  it("picks the object when it appears before an array", () =>
    expect(decodeJson('{"a":[1,2]}')).toEqual({ a: [1, 2] }));
});
