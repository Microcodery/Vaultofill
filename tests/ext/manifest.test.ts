import { describe, it, expect } from "vitest";
import { chromeManifest, firefoxManifest } from "../../src/ext/manifest";

describe("manifest", () => {
  it("Chrome declares sidePanel, offscreen, and contextMenus permissions", () => {
    expect(chromeManifest.permissions).toContain("sidePanel");
    expect(chromeManifest.permissions).toContain("offscreen");
    expect(chromeManifest.permissions).toContain("contextMenus");
  });

  it("Firefox omits the Chrome-only sidePanel/offscreen permissions but keeps contextMenus", () => {
    expect(firefoxManifest.permissions).not.toContain("sidePanel");
    expect(firefoxManifest.permissions).not.toContain("offscreen");
    expect(firefoxManifest.permissions).toContain("contextMenus");
  });

  it("both targets register the open-panel keyboard command with a shortcut", () => {
    for (const m of [chromeManifest, firefoxManifest]) {
      expect(m.commands["open-panel"].suggested_key.default).toBe("Alt+Shift+F");
      expect(m.commands["open-panel"].description).toMatch(/autofill/i);
    }
  });

  it("Chrome uses a side panel; Firefox uses a sidebar action", () => {
    expect(chromeManifest.side_panel.default_path).toBe("sidepanel.html");
    expect(firefoxManifest.sidebar_action.default_panel).toBe("sidepanel.html");
  });
});
