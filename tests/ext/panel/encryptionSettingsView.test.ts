// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderEncryptionSettings, EncryptionSettingsDeps } from "../../../src/ext/panel/encryptionSettingsView";
import { EncryptionConfig } from "../../../src/ext/storage/encryptionConfig";

function makeDeps(overrides: Partial<EncryptionSettingsDeps> & { config?: EncryptionConfig } = {}): {
  deps: EncryptionSettingsDeps;
  enable: ReturnType<typeof vi.fn>;
  disable: ReturnType<typeof vi.fn>;
  setMode: ReturnType<typeof vi.fn>;
  cfg: { current: EncryptionConfig };
} {
  const cfg = { current: overrides.config ?? { enabled: false, unlock: "session" as const } };
  const enable = vi.fn(async () => {});
  const disable = vi.fn(async () => {});
  const setMode = vi.fn(async () => {});
  const deps: EncryptionSettingsDeps = {
    loadConfig: async () => cfg.current,
    enable: overrides.enable ?? enable,
    disable: overrides.disable ?? disable,
    setMode: overrides.setMode ?? setMode,
    minPasswordLength: overrides.minPasswordLength ?? 8,
  };
  return { deps, enable, disable, setMode, cfg };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Pick one of the three choice radios and fire its change event (as a click would). */
function choose(container: HTMLElement, value: "off" | "session" | "always"): void {
  const r = container.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
  r.checked = true;
  r.dispatchEvent(new Event("change"));
}

describe("renderEncryptionSettings", () => {
  it("shows the OFF state with three choices and no action form until one is picked", async () => {
    const { deps } = makeDeps();
    const container = document.createElement("div");
    await renderEncryptionSettings(container, deps);

    expect(container.querySelector(".vof-enc-status")!.textContent).toMatch(/OFF/);
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(container.querySelector<HTMLInputElement>('input[value="off"]')!.checked).toBe(true);
    expect(container.querySelector("form")).toBeNull(); // nothing to do yet

    choose(container, "session");
    expect(container.querySelector('form[aria-label="Turn on encryption"]')).toBeTruthy();
  });

  it("enables with a valid, matching password and the chosen mode", async () => {
    const { deps, enable } = makeDeps();
    const container = document.createElement("div");
    await renderEncryptionSettings(container, deps);
    choose(container, "always");

    const [pw, confirm] = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
    pw!.value = "longenough1";
    confirm!.value = "longenough1";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();

    expect(enable).toHaveBeenCalledWith("longenough1", "always");
  });

  it("rejects a too-short password without calling enable", async () => {
    const { deps, enable } = makeDeps();
    const container = document.createElement("div");
    await renderEncryptionSettings(container, deps);
    choose(container, "session");

    const [pw, confirm] = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
    pw!.value = "short";
    confirm!.value = "short";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();

    expect(enable).not.toHaveBeenCalled();
    expect(container.querySelector(".vof-enc-error")!.textContent).toMatch(/at least 8/);
  });

  it("rejects mismatched passwords without calling enable", async () => {
    const { deps, enable } = makeDeps();
    const container = document.createElement("div");
    await renderEncryptionSettings(container, deps);
    choose(container, "session");

    const [pw, confirm] = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
    pw!.value = "longenough1";
    confirm!.value = "different99";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();

    expect(enable).not.toHaveBeenCalled();
    expect(container.querySelector(".vof-enc-error")!.textContent).toMatch(/do not match/);
  });

  it("turns encryption off via the No-encryption choice + current password", async () => {
    const { deps, disable } = makeDeps({ config: { enabled: true, unlock: "session" } });
    const container = document.createElement("div");
    await renderEncryptionSettings(container, deps);

    expect(container.querySelector(".vof-enc-status")!.textContent).toMatch(/ON.*once per browser/);
    choose(container, "off");
    expect(container.querySelector('form[aria-label="Turn off encryption"]')).toBeTruthy();
    container.querySelector<HTMLInputElement>('input[type="password"]')!.value = "mypassword";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(disable).toHaveBeenCalledWith("mypassword");
  });

  it("surfaces a wrong-password error from disable", async () => {
    const disable = vi.fn(async () => {
      throw new Error("Incorrect password");
    });
    const { deps } = makeDeps({ config: { enabled: true, unlock: "session" }, disable });
    const container = document.createElement("div");
    await renderEncryptionSettings(container, deps);

    choose(container, "off");
    container.querySelector<HTMLInputElement>('input[type="password"]')!.value = "wrong";
    container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await flush();
    expect(container.querySelector(".vof-enc-error")!.textContent).toBe("Incorrect password");
  });

  it("switches unlock frequency with no password (session → panel)", async () => {
    const { deps, setMode, enable, disable } = makeDeps({ config: { enabled: true, unlock: "session" } });
    const container = document.createElement("div");
    await renderEncryptionSettings(container, deps);

    choose(container, "always");
    const form = container.querySelector<HTMLFormElement>('form[aria-label="Change unlock frequency"]')!;
    expect(form).toBeTruthy();
    expect(form.querySelector('input[type="password"]')).toBeNull(); // already unlocked — no password
    form.requestSubmit();
    await flush();

    expect(setMode).toHaveBeenCalledWith("always");
    expect(enable).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });
});
