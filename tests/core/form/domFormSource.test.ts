import { describe, it, expect, vi } from "vitest";
import { DomFormSource } from "../../../src/core/form/domFormSource";
import { FilledEntry, Confidence, FormField } from "../../../src/core/types";

function makePage(readout: unknown) {
  return {
    readForm: vi.fn(async () => readout),
    fill: vi.fn(async () => {}),
    setChecked: vi.fn(async () => {}),
    highlight: vi.fn(async () => {}),
    clickSubmit: vi.fn(async () => {}),
    currentDomain: () => "site.com",
  };
}

describe("DomFormSource", () => {
  it("builds a schema from the deterministic readout (empty label, filled by elementId)", async () => {
    const page = makePage({
      fields: [{ humanReadable: "First name?", elementId: "e1" }],
      submit: { kind: "dom", elementId: "sub" },
    });
    const src = new DomFormSource({ page: page as never });

    const s = await src.getSchema();
    expect(s.fields[0]).toMatchObject({ label: "", humanReadable: "First name?", elementId: "e1" });

    const entry: FilledEntry = { field: s.fields[0]!, value: "Ada", confidence: "connected" };
    await src.stage([entry]);
    expect(page.fill).toHaveBeenCalledWith("e1", "Ada");
    expect(page.highlight).toHaveBeenCalledWith("e1", "yellow"); // connected → yellow

    await src.commit();
    expect(page.clickSubmit).toHaveBeenCalledWith("sub");
  });

  it("stages a radio field by checking the matching option (not fill)", async () => {
    const page = makePage({ fields: [], submit: { kind: "dom", elementId: "sub" } });
    const src = new DomFormSource({ page: page as never });
    await src.getSchema();
    const field: FormField = {
      label: "", humanReadable: "Bed", elementId: "vof-7",
      control: { tag: "radio", options: [{ value: "king", label: "King", elementId: "vof-7" }, { value: "queen", label: "Queen", elementId: "vof-8" }] },
    };
    await src.stage([{ field, value: "queen", confidence: "connected" }]);
    expect(page.setChecked).toHaveBeenCalledWith("vof-8", true);
    expect(page.setChecked).not.toHaveBeenCalledWith("vof-7", expect.any(Boolean)); // radio sibling untouched
    expect(page.fill).not.toHaveBeenCalled();
    expect(page.highlight).toHaveBeenCalledWith("vof-8", "yellow"); // highlights the chosen option
  });

  it("stages a checkbox group by checking each selected option (newline-joined value)", async () => {
    const page = makePage({ fields: [], submit: { kind: "dom", elementId: "sub" } });
    const src = new DomFormSource({ page: page as never });
    await src.getSchema();
    const field: FormField = {
      label: "", humanReadable: "Topics", elementId: "vof-5",
      control: { tag: "checkbox", options: [
        { value: "ai", label: "AI", elementId: "vof-5" },
        { value: "security", label: "Security", elementId: "vof-6" },
        { value: "design", label: "Design", elementId: "vof-7" },
      ] },
    };
    await src.stage([{ field, value: "ai\ndesign", confidence: "certain" }]);
    expect(page.setChecked).toHaveBeenCalledWith("vof-5", true);
    expect(page.setChecked).toHaveBeenCalledWith("vof-6", false);
    expect(page.setChecked).toHaveBeenCalledWith("vof-7", true);
  });

  it("throws when no submit control was found", async () => {
    const page = makePage({ fields: [{ humanReadable: "Name", elementId: "e1" }], submit: null });
    const src = new DomFormSource({ page: page as never });
    await expect(src.getSchema()).rejects.toThrow(/submit/);
  });

  it("a seeded schema (restored session) can stage + commit without a fresh read", async () => {
    const page = makePage(undefined); // never read: readForm not called
    const src = new DomFormSource({
      page: page as never,
      schema: { fields: [], submit: { kind: "dom", elementId: "sub" } },
    });
    const field: FormField = { label: "EMAIL", humanReadable: "Email", elementId: "e1" };
    await src.stage([{ field, value: "a@b.com", confidence: "certain" }]);
    expect(page.fill).toHaveBeenCalledWith("e1", "a@b.com");
    await src.commit();
    expect(page.clickSubmit).toHaveBeenCalledWith("sub");
    expect(page.readForm).not.toHaveBeenCalled();
  });

  it.each<[Confidence, string]>([
    ["certain", "green"],
    ["connected", "yellow"],
    ["missing", "red"],
  ])("stage highlights with %s confidence → %s color", async (confidence, color) => {
    const page = makePage({
      fields: [{ humanReadable: "First name?", elementId: "e1" }],
      submit: { kind: "dom", elementId: "sub" },
    });
    const src = new DomFormSource({ page: page as never });
    const s = await src.getSchema();
    const entry: FilledEntry = { field: s.fields[0]!, value: "Test Value", confidence };
    await src.stage([entry]);
    expect(page.highlight).toHaveBeenCalledWith("e1", color);
  });
});
