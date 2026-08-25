import { describe, it, expect, vi } from "vitest";
import { buildLabelPrompt, labelQuestions } from "../../../src/core/labels/labelQuestions";
import { CanonicalLabel } from "../../../src/core/labels/canonicalLabels";

const VOCAB: CanonicalLabel[] = [
  { name: "EMAIL", description: "Email address", aliases: [] },
  { name: "FIRST_NAME", description: "Given name", aliases: [] },
];

describe("buildLabelPrompt", () => {
  it("includes every vocab name and every question", () => {
    const req = buildLabelPrompt(["Email address", "First name"], VOCAB);
    const text = req.system + JSON.stringify(req.messages);
    expect(text).toContain("EMAIL");
    expect(text).toContain("FIRST_NAME");
    expect(text).toContain("Email address");
    expect(text).toContain("First name");
  });

  it("renders a label's aliases as 'also called' hints", () => {
    const vocab: CanonicalLabel[] = [{ name: "EMAIL", description: "Email address", aliases: ["e-mail", "work email"] }];
    const req = buildLabelPrompt(["Your email"], vocab);
    expect(req.system).toContain("also called: e-mail, work email");
  });

  it("omits the 'also called' hint when a label has no aliases", () => {
    const req = buildLabelPrompt(["Your email"], VOCAB);
    expect(req.system).not.toContain("also called");
  });
});

describe("labelQuestions", () => {
  it("returns the model's mapping when valid", async () => {
    const model = { complete: vi.fn(async () => ({ "Email address": "EMAIL", "First name": "FIRST_NAME" })) };
    const out = await labelQuestions(["Email address", "First name"], VOCAB, model as never);
    expect(out).toEqual({ "Email address": "EMAIL", "First name": "FIRST_NAME" });
  });

  it("accepts a NEW well-formed label the model invents for a novel field", async () => {
    const model = { complete: vi.fn(async () => ({ "Cumulative GPA": "CUMULATIVE_GPA" })) };
    const out = await labelQuestions(["Cumulative GPA"], VOCAB, model as never);
    expect(out).toEqual({ "Cumulative GPA": "CUMULATIVE_GPA" });
  });

  it("normalises a free-form new label to UPPER_SNAKE_CASE", async () => {
    const model = { complete: vi.fn(async () => ({ "Vehicle make": "vehicle make!" })) };
    const out = await labelQuestions(["Vehicle make"], VOCAB, model as never);
    expect(out).toEqual({ "Vehicle make": "VEHICLE_MAKE" });
  });

  it("coerces junk (empty / non-label) to UNKNOWN", async () => {
    const model = { complete: vi.fn(async () => ({ a: "", b: "???" })) };
    const out = await labelQuestions(["a", "b"], VOCAB, model as never);
    expect(out).toEqual({ a: "UNKNOWN", b: "UNKNOWN" });
  });

  it("fills a question missing from the reply as UNKNOWN", async () => {
    const model = { complete: vi.fn(async () => ({ "Email address": "EMAIL" })) };
    const out = await labelQuestions(["Email address", "First name"], VOCAB, model as never);
    expect(out).toEqual({ "Email address": "EMAIL", "First name": "UNKNOWN" });
  });

  it("passes UNKNOWN through unchanged", async () => {
    const model = { complete: vi.fn(async () => ({ "Mystery field": "UNKNOWN" })) };
    const out = await labelQuestions(["Mystery field"], VOCAB, model as never);
    expect(out).toEqual({ "Mystery field": "UNKNOWN" });
  });

  it("accepts an array response, zipping labels to questions in order", async () => {
    const model = { complete: vi.fn(async () => ["EMAIL", "FIRST_NAME"]) };
    const out = await labelQuestions(["Email address", "First name"], VOCAB, model as never);
    expect(out).toEqual({ "Email address": "EMAIL", "First name": "FIRST_NAME" });
  });

  it("returns {} and does not call the model for no questions", async () => {
    const model = { complete: vi.fn() };
    const out = await labelQuestions([], VOCAB, model as never);
    expect(out).toEqual({});
    expect(model.complete).not.toHaveBeenCalled();
  });

  it("degrades every question to UNKNOWN when the model call/parse throws", async () => {
    const model = { complete: vi.fn(async () => { throw new Error("JsonParseError: truncated"); }) };
    const out = await labelQuestions(["Email address", "First name"], VOCAB, model as never);
    expect(out).toEqual({ "Email address": "UNKNOWN", "First name": "UNKNOWN" });
  });
});
