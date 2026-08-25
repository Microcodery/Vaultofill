import { describe, it, expect, vi } from "vitest";
import { pickTargetTab } from "../../../src/ext/panel/pickTargetTab";

describe("pickTargetTab", () => {
  it("uses getTab when an explicit tab id is given, and skips queryActiveTab", async () => {
    const getTab = vi.fn().mockResolvedValue({ id: 7, url: "https://example.com/page" });
    const queryActiveTab = vi.fn();

    const result = await pickTargetTab(7, { getTab, queryActiveTab });

    expect(getTab).toHaveBeenCalledWith(7);
    expect(queryActiveTab).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 7, domain: "example.com" });
  });

  it("falls back to queryActiveTab when no explicit tab id is given", async () => {
    const getTab = vi.fn();
    const queryActiveTab = vi.fn().mockResolvedValue({ id: 9, url: "https://foo.bar/path" });

    const result = await pickTargetTab(undefined, { getTab, queryActiveTab });

    expect(getTab).not.toHaveBeenCalled();
    expect(queryActiveTab).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 9, domain: "foo.bar" });
  });

  it("returns undefined when the resolved tab has no id", async () => {
    const getTab = vi.fn().mockResolvedValue({ url: "https://example.com" });
    const queryActiveTab = vi.fn();

    const result = await pickTargetTab(7, { getTab, queryActiveTab });

    expect(result).toBeUndefined();
  });

  it("returns undefined when queryActiveTab resolves to a tab with no id", async () => {
    const getTab = vi.fn();
    const queryActiveTab = vi.fn().mockResolvedValue(undefined);

    const result = await pickTargetTab(undefined, { getTab, queryActiveTab });

    expect(result).toBeUndefined();
  });

  it("uses an empty string domain when the tab has no url", async () => {
    const getTab = vi.fn().mockResolvedValue({ id: 3 });
    const queryActiveTab = vi.fn();

    const result = await pickTargetTab(3, { getTab, queryActiveTab });

    expect(result).toEqual({ id: 3, domain: "" });
  });
});
